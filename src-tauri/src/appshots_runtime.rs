//! One thread owns the native registration and every capture lease. These are
//! internal events: the renderer adapter must project metadata, never serialize
//! native targets, process paths or worker transport data indiscriminately.
use crate::{
    appshots_capture_task::CaptureTask,
    appshots_entry::{
        Controller, Destination, Hotkey, PrimaryWindow, Registration, Route, Scope, State,
    },
    appshots_host::{HostCapture, HostError},
    appshots_native_entry::{EntryEvent, NativeEntry},
    appshots_target::{read_target_metadata, TargetError, TargetMetadata},
};
use std::{
    io,
    path::PathBuf,
    sync::{mpsc, Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct RuntimeConfiguration {
    pub scope: Scope,
    pub origin: String,
    pub eligible: Option<bool>,
    pub capable: bool,
    pub hotkey: Option<Hotkey>,
    pub destination: Destination,
    pub primary: Option<PrimaryWindow>,
    pub work_allowed: Option<bool>,
}

#[derive(Debug)]
pub(crate) enum RuntimeFailure {
    Native(u32),
    Target(TargetError),
    Capture(HostError),
    Cleanup(Arc<HostError>),
}

pub(crate) enum RuntimeEvent {
    State(State),
    Route {
        id: Uuid,
        scope: Scope,
        origin: String,
        route: Route,
        metadata: TargetMetadata,
    },
    CaptureReady {
        id: Uuid,
        scope: Scope,
        origin: String,
        metadata: TargetMetadata,
        capture: HostCapture,
    },
    Retired {
        id: Uuid,
    },
    Failed {
        id: Option<Uuid>,
        error: RuntimeFailure,
    },
}

#[derive(Clone, Debug)]
pub(crate) enum RuntimeError {
    Closed,
    OwnerPanicked,
    Cleanup(Arc<HostError>),
}

enum Command {
    Configure(
        RuntimeConfiguration,
        mpsc::Sender<Result<State, RuntimeError>>,
    ),
    Claim(
        Uuid,
        String,
        Scope,
        mpsc::Sender<Result<bool, RuntimeError>>,
    ),
    Reserve(
        Uuid,
        String,
        Scope,
        mpsc::Sender<Result<bool, RuntimeError>>,
    ),
    Commit(
        Uuid,
        String,
        Scope,
        mpsc::Sender<Result<bool, RuntimeError>>,
    ),
    Decline(
        Uuid,
        String,
        Scope,
        mpsc::Sender<Result<bool, RuntimeError>>,
    ),
    Handoff(
        Uuid,
        String,
        Scope,
        Scope,
        mpsc::Sender<Result<bool, RuntimeError>>,
    ),
    Shutdown,
}

struct OwnerThread {
    handle: Option<JoinHandle<Result<(), RuntimeError>>>,
    result: Option<Result<(), RuntimeError>>,
}

pub(crate) struct AppshotsRuntime {
    commands: mpsc::Sender<Command>,
    thread: Mutex<OwnerThread>,
}

impl AppshotsRuntime {
    pub fn start(root: PathBuf, emit: impl Fn(RuntimeEvent) + Send + 'static) -> io::Result<Self> {
        let (commands, receiver) = mpsc::channel();
        let owner = thread::Builder::new()
            .name("appshots-owner".into())
            .spawn(move || Owner::new(root, Box::new(emit)).run(receiver))?;
        Ok(Self {
            commands,
            thread: Mutex::new(OwnerThread {
                handle: Some(owner),
                result: None,
            }),
        })
    }

    // Call from spawn_blocking when a renderer command needs a reply: retirement
    // includes awaiting the old worker's process cleanup before replying.
    fn request<T>(
        &self,
        command: impl FnOnce(mpsc::Sender<Result<T, RuntimeError>>) -> Command,
    ) -> Result<T, RuntimeError> {
        let (send, receive) = mpsc::channel();
        self.commands
            .send(command(send))
            .map_err(|_| RuntimeError::Closed)?;
        receive.recv().map_err(|_| RuntimeError::Closed)?
    }

    pub fn configure(&self, config: RuntimeConfiguration) -> Result<State, RuntimeError> {
        self.request(|reply| Command::Configure(config, reply))
    }
    pub fn claim(&self, id: Uuid, origin: String, scope: Scope) -> Result<bool, RuntimeError> {
        self.request(|reply| Command::Claim(id, origin, scope, reply))
    }
    pub fn reserve_accept(
        &self,
        id: Uuid,
        origin: String,
        scope: Scope,
    ) -> Result<bool, RuntimeError> {
        self.request(|reply| Command::Reserve(id, origin, scope, reply))
    }
    pub fn commit_accept(
        &self,
        id: Uuid,
        origin: String,
        scope: Scope,
    ) -> Result<bool, RuntimeError> {
        self.request(|reply| Command::Commit(id, origin, scope, reply))
    }
    pub fn decline(&self, id: Uuid, origin: String, scope: Scope) -> Result<bool, RuntimeError> {
        self.request(|reply| Command::Decline(id, origin, scope, reply))
    }
    pub fn handoff_new_chat(
        &self,
        id: Uuid,
        origin: String,
        from: Scope,
        to: Scope,
    ) -> Result<bool, RuntimeError> {
        self.request(|reply| Command::Handoff(id, origin, from, to, reply))
    }
    pub fn shutdown(&self) -> Result<(), RuntimeError> {
        let mut thread = self
            .thread
            .lock()
            .map_err(|_| RuntimeError::OwnerPanicked)?;
        if let Some(owner) = thread.handle.take() {
            let _ = self.commands.send(Command::Shutdown);
            thread.result = Some(owner.join().unwrap_or(Err(RuntimeError::OwnerPanicked)));
        }
        thread.result.clone().unwrap_or(Ok(()))
    }
}

impl Drop for AppshotsRuntime {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

struct Flight {
    id: Uuid,
    generation: u64,
    epoch: u64,
    origin: String,
    scope: Scope,
    metadata: TargetMetadata,
    route: Route,
    claimed: bool,
    reserved: bool,
    accepted: bool,
    handed_off: bool,
    task: Option<CaptureTask>,
}

struct Owner {
    root: PathBuf,
    emit: Box<dyn Fn(RuntimeEvent) + Send>,
    controller: Controller,
    config: Option<RuntimeConfiguration>,
    native: Option<NativeEntry>,
    generation: u64,
    flight: Option<Flight>,
    installation_deadline: Option<Instant>,
    poison: Option<Arc<HostError>>,
}

impl Owner {
    fn new(root: PathBuf, emit: Box<dyn Fn(RuntimeEvent) + Send>) -> Self {
        Self {
            root,
            emit,
            controller: Controller::default(),
            config: None,
            native: None,
            generation: 0,
            flight: None,
            installation_deadline: None,
            poison: None,
        }
    }

    fn run(mut self, commands: mpsc::Receiver<Command>) -> Result<(), RuntimeError> {
        loop {
            match commands.recv_timeout(Duration::from_millis(10)) {
                Ok(Command::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Ok(command) => self.command(command),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            self.check_epoch();
            let event = self
                .native
                .as_mut()
                .and_then(|entry| entry.next(Duration::from_millis(1)));
            if let Some(event) = event {
                self.native_event(event);
            }
            self.check_epoch();
            self.finish();
        }
        self.retire();
        // NativeEntry is constructed, polled and dropped only on this thread.
        self.native.take();
        self.health()
    }

    fn health(&self) -> Result<(), RuntimeError> {
        self.poison
            .as_ref()
            .map_or(Ok(()), |error| Err(RuntimeError::Cleanup(error.clone())))
    }

    fn poison(&mut self, id: Uuid, error: HostError) {
        let error = Arc::new(error);
        self.poison.get_or_insert_with(|| error.clone());
        self.controller.registration_failed(self.generation);
        self.controller.retire();
        self.native.take();
        self.installation_deadline = None;
        (self.emit)(RuntimeEvent::Failed {
            id: Some(id),
            error: RuntimeFailure::Cleanup(error),
        });
        self.state();
    }

    fn retire(&mut self) {
        self.controller.retire();
        if let Some(mut flight) = self.flight.take() {
            if let Some(task) = flight.task.take() {
                if let Err(error) = tauri::async_runtime::block_on(task.cancel()) {
                    self.poison(flight.id, error);
                }
            }
            (self.emit)(RuntimeEvent::Retired { id: flight.id });
        }
    }

    fn state(&self) {
        (self.emit)(RuntimeEvent::State(self.controller.state()));
    }

    fn configure(&mut self, config: RuntimeConfiguration) -> Result<State, RuntimeError> {
        self.health()?;
        let replace = self.config.as_ref().is_none_or(|old| {
            old.eligible != config.eligible
                || old.capable != config.capable
                || old.hotkey != config.hotkey
        });
        let context_changed = self
            .config
            .as_ref()
            .is_some_and(|old| old.scope != config.scope || old.origin != config.origin);
        let consumer_lost = self.flight.as_ref().is_some_and(|flight| {
            !config
                .primary
                .as_ref()
                .is_some_and(|p| p.is_primary && p.alive && (!flight.accepted || p.can_accept))
        });
        if replace || context_changed || consumer_lost {
            self.retire();
            self.health()?;
        }
        if replace {
            self.native.take();
            self.installation_deadline = None;
            let change = self
                .controller
                .reconcile(config.eligible, config.capable, config.hotkey);
            self.generation = change.generation;
            if let Some(hotkey) = change.hotkey {
                match NativeEntry::start(hotkey) {
                    Ok(entry) => {
                        self.native = Some(entry);
                        self.installation_deadline = Some(Instant::now() + Duration::from_secs(5));
                    }
                    Err(code) => {
                        self.controller.registration_failed(self.generation);
                        (self.emit)(RuntimeEvent::Failed {
                            id: None,
                            error: RuntimeFailure::Native(code),
                        });
                    }
                }
            }
        }
        self.config = Some(config);
        self.state();
        Ok(self.controller.state())
    }

    fn matches(&self, id: Uuid, origin: &str, scope: &Scope) -> bool {
        self.config.as_ref().is_some_and(|c| {
            c.origin == origin
                && c.scope == *scope
                && c.primary.as_ref().is_some_and(|p| p.is_primary && p.alive)
        }) && self.flight.as_ref().is_some_and(|f| {
            f.id == id
                && f.origin == origin
                && f.scope == *scope
                && f.generation == self.generation
                && f.epoch == self.controller.state().input_epoch
        })
    }

    fn command(&mut self, command: Command) {
        self.check_epoch();
        if let Err(error) = self.health() {
            match command {
                Command::Configure(_, reply) => {
                    let _ = reply.send(Err(error));
                }
                Command::Claim(_, _, _, reply)
                | Command::Reserve(_, _, _, reply)
                | Command::Commit(_, _, _, reply)
                | Command::Decline(_, _, _, reply)
                | Command::Handoff(_, _, _, _, reply) => {
                    let _ = reply.send(Err(error));
                }
                Command::Shutdown => {}
            }
            return;
        }
        match command {
            Command::Configure(config, reply) => {
                let result = self.configure(config);
                let _ = reply.send(result);
            }
            Command::Claim(id, origin, scope, reply) => {
                let accepted = self.matches(id, &origin, &scope)
                    && self.controller.claim(id, &origin, &scope.account);
                if accepted {
                    self.flight.as_mut().unwrap().claimed = true;
                }
                let _ = reply.send(Ok(accepted));
            }
            Command::Reserve(id, origin, scope, reply) => {
                let accepted = self.matches(id, &origin, &scope)
                    && self
                        .config
                        .as_ref()
                        .is_some_and(|c| c.primary.as_ref().is_some_and(|p| p.can_accept))
                    && self.flight.as_ref().is_some_and(|f| {
                        f.claimed
                            && !f.reserved
                            && !f.accepted
                            && (f.route == Route::Current || f.handed_off)
                    });
                if accepted {
                    self.flight.as_mut().unwrap().reserved = true;
                }
                let _ = reply.send(Ok(accepted));
            }
            Command::Commit(id, origin, scope, reply) => {
                let accepted = self.matches(id, &origin, &scope)
                    && self
                        .config
                        .as_ref()
                        .is_some_and(|c| c.primary.as_ref().is_some_and(|p| p.can_accept))
                    && self
                        .flight
                        .as_ref()
                        .is_some_and(|f| f.claimed && f.reserved && !f.accepted)
                    && self.controller.consume(id, &origin, &scope);
                if accepted {
                    self.flight.as_mut().unwrap().accepted = true;
                    self.start_capture();
                }
                let _ = reply.send(self.health().map(|_| accepted));
            }
            Command::Decline(id, origin, scope, reply) => {
                let accepted = self.matches(id, &origin, &scope)
                    && self.controller.cancel(id, &origin, &scope);
                if accepted {
                    self.retire();
                }
                let _ = reply.send(self.health().map(|_| accepted));
            }
            Command::Handoff(id, origin, from, to, reply) => {
                let accepted = self.matches(id, &origin, &from)
                    && self
                        .config
                        .as_ref()
                        .is_some_and(|c| c.work_allowed == Some(true))
                    && from.account == to.account
                    && from != to
                    && !to.composer.is_empty()
                    && self.flight.as_ref().is_some_and(|f| {
                        f.claimed
                            && !f.reserved
                            && !f.accepted
                            && !f.handed_off
                            && f.route == Route::NewChat
                    });
                if accepted {
                    let flight = self.flight.as_mut().unwrap();
                    flight.scope = to.clone();
                    flight.handed_off = true;
                    self.config.as_mut().unwrap().scope = to;
                }
                let _ = reply.send(Ok(accepted));
            }
            Command::Shutdown => {}
        }
    }

    fn check_epoch(&mut self) {
        let Some(epoch) = self.native.as_ref().map(NativeEntry::input_epoch) else {
            return;
        };
        self.observe_epoch(epoch);
    }

    fn observe_epoch(&mut self, epoch: u64) {
        // Zero before Installed is not a failed live registration. Let its ACK
        // arrive, bounded by an installation deadline rather than retiring it
        // during the very first owner poll.
        let pending = self.controller.state().registration == Registration::Pending;
        let timed_out = pending
            && self
                .installation_deadline
                .is_some_and(|deadline| Instant::now() >= deadline);
        if pending && epoch == 0 && !timed_out {
            return;
        }
        if timed_out {
            (self.emit)(RuntimeEvent::Failed {
                id: None,
                error: RuntimeFailure::Native(1460),
            });
        }
        if epoch == 0 || timed_out {
            self.controller.registration_failed(self.generation);
            self.retire();
            self.native.take();
            self.installation_deadline = None;
            self.state();
        } else if epoch > self.controller.state().input_epoch {
            self.controller.input_reset(self.generation, epoch);
            self.retire();
            self.state();
        }
    }

    fn dispatch(&self) {
        if let Some(flight) = self.flight.as_ref().filter(|f| f.route != Route::Skip) {
            (self.emit)(RuntimeEvent::Route {
                id: flight.id,
                scope: flight.scope.clone(),
                origin: flight.origin.clone(),
                route: flight.route,
                metadata: flight.metadata.clone(),
            });
        }
    }

    fn native_event(&mut self, event: EntryEvent) {
        match event {
            EntryEvent::Installed { input_epoch } => {
                if self
                    .controller
                    .registration_ready(self.generation, input_epoch)
                {
                    self.installation_deadline = None;
                }
                self.state();
            }
            EntryEvent::Reset { input_epoch, .. } => {
                if input_epoch > self.controller.state().input_epoch {
                    self.controller.input_reset(self.generation, input_epoch);
                    self.retire();
                    self.state();
                }
            }
            EntryEvent::Failed(code) => {
                self.controller.registration_failed(self.generation);
                self.retire();
                self.native.take();
                self.state();
                (self.emit)(RuntimeEvent::Failed {
                    id: None,
                    error: RuntimeFailure::Native(code),
                });
            }
            EntryEvent::Closed => {
                self.controller.registration_failed(self.generation);
                self.retire();
                self.native.take();
                self.state();
            }
            EntryEvent::Down {
                input_epoch,
                target,
            } => {
                let target = match target {
                    Ok(target) => target,
                    Err(code) => {
                        (self.emit)(RuntimeEvent::Failed {
                            id: None,
                            error: RuntimeFailure::Native(code),
                        });
                        return;
                    }
                };
                let Some(start) = self.controller.down(self.generation, input_epoch, target) else {
                    return;
                };
                // Retire the old task without retiring the new controller flight.
                if let Some(mut old) = self.flight.take() {
                    if let Some(task) = old.task.take() {
                        if let Err(error) = tauri::async_runtime::block_on(task.cancel()) {
                            self.poison(old.id, error);
                            (self.emit)(RuntimeEvent::Retired { id: old.id });
                            return;
                        }
                    }
                    (self.emit)(RuntimeEvent::Retired { id: old.id });
                }
                let metadata = match read_target_metadata(target) {
                    Ok(metadata) => metadata,
                    Err(error) => {
                        self.controller.retire();
                        (self.emit)(RuntimeEvent::Failed {
                            id: Some(start.id),
                            error: RuntimeFailure::Target(error),
                        });
                        return;
                    }
                };
                self.check_epoch();
                if self.controller.state().input_epoch != input_epoch {
                    return;
                }
                let Some(config) = self.config.as_ref() else {
                    self.controller.retire();
                    return;
                };
                let route = self.controller.route_down(
                    start.id,
                    config.destination,
                    config.primary.as_ref(),
                    now_ms(),
                );
                self.flight = Some(Flight {
                    id: start.id,
                    generation: self.generation,
                    epoch: input_epoch,
                    origin: config.origin.clone(),
                    scope: config.scope.clone(),
                    metadata,
                    route,
                    claimed: false,
                    reserved: false,
                    accepted: false,
                    handed_off: false,
                    task: None,
                });
                self.dispatch();
            }
            EntryEvent::Up { input_epoch } => {
                let Some(config) = self.config.as_ref() else {
                    return;
                };
                if let Some((id, route)) = self.controller.up(
                    self.generation,
                    input_epoch,
                    config.destination,
                    config.primary.as_ref(),
                    now_ms(),
                    config.work_allowed == Some(true),
                ) {
                    if let Some(flight) = self.flight.as_mut().filter(|f| f.id == id) {
                        if route != Route::Skip {
                            flight.route = route;
                            self.dispatch();
                        }
                        self.start_capture();
                    }
                }
            }
        }
    }

    fn start_capture(&mut self) {
        self.check_epoch();
        if self.health().is_err() {
            return;
        }
        let Some(flight) = self
            .flight
            .as_mut()
            .filter(|f| f.accepted && f.task.is_none())
        else {
            return;
        };
        if let Some(target) =
            self.controller
                .start_capture(flight.id, &flight.origin, &flight.scope)
        {
            flight.task = Some(CaptureTask::start(
                flight.id,
                flight.origin.clone(),
                flight.scope.clone(),
                target,
                self.root.clone(),
                Duration::from_secs(15),
            ));
        }
    }

    fn finish(&mut self) {
        if !self
            .flight
            .as_ref()
            .and_then(|f| f.task.as_ref())
            .is_some_and(CaptureTask::is_finished)
        {
            return;
        }
        self.check_epoch();
        let Some(flight) = self.flight.as_mut() else {
            return;
        };
        let Some(task) = flight.task.take() else {
            return;
        };
        let id = flight.id;
        let result =
            tauri::async_runtime::block_on(task.finish(flight.id, &flight.origin, &flight.scope));
        let result = match result {
            Err(error) if matches!(&error, HostError::CleanupFailed | HostError::ReapFailed) => {
                self.poison(id, error);
                self.retire();
                return;
            }
            result => result,
        };
        self.check_epoch();
        let Some(flight) = self.flight.as_ref() else {
            return;
        };
        if !self.matches(flight.id, &flight.origin, &flight.scope) {
            self.retire();
            return;
        }
        let flight = self.flight.take().unwrap();
        match result {
            Ok(capture)
                if self
                    .controller
                    .complete(flight.id, &flight.origin, &flight.scope) =>
            {
                (self.emit)(RuntimeEvent::CaptureReady {
                    id: flight.id,
                    scope: flight.scope,
                    origin: flight.origin,
                    metadata: flight.metadata,
                    capture,
                });
            }
            Err(error) => {
                self.controller.retire();
                (self.emit)(RuntimeEvent::Failed {
                    id: Some(flight.id),
                    error: RuntimeFailure::Capture(error),
                });
            }
            _ => {
                self.controller.retire();
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::appshots_host::CaptureTarget;
    use std::sync::{Arc, Mutex};

    fn scope(composer: &str) -> Scope {
        Scope {
            account: "user:account".into(),
            composer: composer.into(),
        }
    }
    fn config() -> RuntimeConfiguration {
        RuntimeConfiguration {
            scope: scope("original"),
            origin: "main".into(),
            eligible: Some(true),
            capable: true,
            hotkey: Some(Hotkey::DoubleAlt),
            destination: Destination::Automatic,
            primary: Some(PrimaryWindow {
                is_primary: true,
                alive: true,
                can_accept: true,
                focused: true,
                last_active_ms: None,
                is_new_chat: false,
            }),
            work_allowed: None,
        }
    }
    fn owner(route: Route) -> (Owner, Uuid) {
        let mut owner = Owner::new(PathBuf::new(), Box::new(|_| {}));
        owner.config = Some(config());
        let change = owner
            .controller
            .reconcile(Some(true), true, Some(Hotkey::DoubleAlt));
        owner.generation = change.generation;
        assert!(owner.controller.registration_ready(change.generation, 1));
        let start = owner
            .controller
            .down(
                change.generation,
                1,
                CaptureTarget {
                    hwnd: 1,
                    pid: 2,
                    process_creation_time: 3,
                },
            )
            .unwrap();
        // Authorize the same production controller routing used by native input.
        assert_eq!(
            owner.controller.route_down(
                start.id,
                Destination::Automatic,
                owner.config.as_ref().unwrap().primary.as_ref(),
                now_ms()
            ),
            Route::Current
        );
        owner.flight = Some(Flight {
            id: start.id,
            generation: change.generation,
            epoch: 1,
            origin: "main".into(),
            scope: scope("original"),
            route,
            claimed: false,
            reserved: false,
            accepted: false,
            handed_off: false,
            task: None,
            metadata: TargetMetadata {
                app_identifier: "process:C:\\fixture.exe".into(),
                display_name: "fixture".into(),
                window_title: None,
            },
        });
        (owner, start.id)
    }
    fn boolean(
        owner: &mut Owner,
        command: impl FnOnce(mpsc::Sender<Result<bool, RuntimeError>>) -> Command,
    ) -> bool {
        let (send, receive) = mpsc::channel();
        owner.command(command(send));
        receive.recv().unwrap().unwrap()
    }

    #[test]
    fn claim_and_accept_require_original_context_and_are_single_use() {
        let (mut owner, id) = owner(Route::Current);
        assert!(!boolean(&mut owner, |reply| Command::Commit(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        assert!(!boolean(&mut owner, |reply| Command::Claim(
            id,
            "other".into(),
            scope("original"),
            reply
        )));
        assert!(boolean(&mut owner, |reply| Command::Claim(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        assert!(!boolean(&mut owner, |reply| Command::Reserve(
            id,
            "main".into(),
            scope("other"),
            reply
        )));
        assert!(owner.flight.as_ref().unwrap().task.is_none());
        assert!(boolean(&mut owner, |reply| Command::Reserve(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        assert!(!boolean(&mut owner, |reply| Command::Reserve(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        // No release: acceptance must not start a worker early.
        assert!(owner.flight.as_ref().unwrap().task.is_none());
        assert!(boolean(&mut owner, |reply| Command::Commit(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        assert!(!boolean(&mut owner, |reply| Command::Commit(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
    }

    #[test]
    fn ordinary_configure_cannot_inherit_claim_or_acceptance() {
        let (mut owner, id) = owner(Route::Current);
        assert!(boolean(&mut owner, |reply| Command::Claim(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        let mut next = config();
        next.scope = scope("new-composer");
        owner.configure(next).unwrap();
        assert!(owner.flight.is_none());
        assert!(!boolean(&mut owner, |reply| Command::Reserve(
            id,
            "main".into(),
            scope("new-composer"),
            reply
        )));
    }

    #[test]
    fn new_chat_requires_independent_work_permission_and_one_explicit_handoff() {
        let (mut owner, id) = owner(Route::NewChat);
        assert!(boolean(&mut owner, |reply| Command::Claim(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        assert!(!boolean(&mut owner, |reply| Command::Reserve(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        assert!(!boolean(&mut owner, |reply| Command::Handoff(
            id,
            "main".into(),
            scope("original"),
            scope("new"),
            reply
        )));
        owner.config.as_mut().unwrap().work_allowed = Some(true);
        assert!(boolean(&mut owner, |reply| Command::Handoff(
            id,
            "main".into(),
            scope("original"),
            scope("new"),
            reply
        )));
        assert!(!boolean(&mut owner, |reply| Command::Handoff(
            id,
            "main".into(),
            scope("new"),
            scope("another"),
            reply
        )));
        assert!(boolean(&mut owner, |reply| Command::Reserve(
            id,
            "main".into(),
            scope("new"),
            reply
        )));
    }

    #[test]
    fn decline_retires_without_worker_and_configuration_does_not_revive_it() {
        let retired = Arc::new(Mutex::new(Vec::new()));
        let events = retired.clone();
        let (mut owner, id) = owner(Route::Current);
        owner.emit = Box::new(move |event| {
            if let RuntimeEvent::Retired { id } = event {
                events.lock().unwrap().push(id);
            }
        });
        assert!(boolean(&mut owner, |reply| Command::Claim(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        assert!(boolean(&mut owner, |reply| Command::Decline(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        owner.configure(config()).unwrap();
        assert!(!boolean(&mut owner, |reply| Command::Reserve(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        assert_eq!(*retired.lock().unwrap(), vec![id]);
    }

    #[test]
    fn initial_zero_epoch_waits_for_real_installed_ack() {
        let mut owner = Owner::new(PathBuf::new(), Box::new(|_| {}));
        let change = owner
            .controller
            .reconcile(Some(true), true, Some(Hotkey::DoubleAlt));
        owner.generation = change.generation;
        owner.installation_deadline = Some(Instant::now() + Duration::from_secs(5));
        owner.observe_epoch(0);
        assert_eq!(owner.controller.state().registration, Registration::Pending);
        owner.native_event(EntryEvent::Installed { input_epoch: 1 });
        assert_eq!(owner.controller.state().registration, Registration::Ready);
        assert!(owner.installation_deadline.is_none());
        owner.observe_epoch(0);
        assert_eq!(owner.controller.state().registration, Registration::None);
    }

    #[test]
    fn pending_installation_timeout_and_failure_are_terminal() {
        for timeout in [true, false] {
            let mut owner = Owner::new(PathBuf::new(), Box::new(|_| {}));
            let change = owner
                .controller
                .reconcile(Some(true), true, Some(Hotkey::DoubleAlt));
            owner.generation = change.generation;
            owner.installation_deadline = Some(Instant::now() - Duration::from_secs(1));
            if timeout {
                owner.observe_epoch(0);
            } else {
                owner.native_event(EntryEvent::Failed(5));
            }
            assert_eq!(owner.controller.state().registration, Registration::None);
            owner.native_event(EntryEvent::Installed { input_epoch: 1 });
            assert_eq!(owner.controller.state().registration, Registration::None);
        }
    }

    #[test]
    fn reserved_lease_cannot_commit_after_cancel_context_or_epoch_retirement() {
        for change in ["cancel", "context", "epoch"] {
            let (mut owner, id) = owner(Route::Current);
            assert!(boolean(&mut owner, |reply| Command::Claim(
                id,
                "main".into(),
                scope("original"),
                reply
            )));
            assert!(!boolean(&mut owner, |reply| Command::Reserve(
                Uuid::new_v4(),
                "main".into(),
                scope("original"),
                reply
            )));
            assert!(boolean(&mut owner, |reply| Command::Reserve(
                id,
                "main".into(),
                scope("original"),
                reply
            )));
            assert!(owner.flight.as_ref().unwrap().task.is_none());
            match change {
                "cancel" => assert!(boolean(&mut owner, |reply| Command::Decline(
                    id,
                    "main".into(),
                    scope("original"),
                    reply
                ))),
                "context" => {
                    let mut next = config();
                    next.scope = scope("new");
                    owner.configure(next).unwrap();
                }
                _ => owner.observe_epoch(2),
            }
            assert!(!boolean(&mut owner, |reply| Command::Commit(
                id,
                "main".into(),
                scope("original"),
                reply
            )));
            assert!(owner.flight.is_none());
        }
    }

    #[test]
    fn failed_real_task_cancellation_poison_blocks_configuration_and_capture() {
        use std::sync::atomic::{AtomicBool, Ordering};
        for error in [HostError::CleanupFailed, HostError::ReapFailed] {
            let (mut owner, id) = owner(Route::Current);
            let cancelled = Arc::new(AtomicBool::new(false));
            let observed = cancelled.clone();
            owner.flight.as_mut().unwrap().task = Some(CaptureTask::spawn(
                id,
                "main".into(),
                scope("original"),
                move |cancel| async move {
                    let _ = cancel.await;
                    observed.store(true, Ordering::SeqCst);
                    Err(error)
                },
            ));
            let generation = owner.generation;
            let mut next = config();
            next.scope = scope("new");
            assert!(matches!(
                owner.configure(next),
                Err(RuntimeError::Cleanup(_))
            ));
            assert!(
                cancelled.load(Ordering::SeqCst),
                "must await the actual task's cancellation"
            );
            assert!(owner.flight.is_none());
            assert!(owner.native.is_none());
            assert_eq!(owner.controller.state().registration, Registration::None);
            assert_eq!(owner.generation, generation);
            let (reply, result) = mpsc::channel();
            owner.command(Command::Configure(config(), reply));
            assert!(matches!(
                result.recv().unwrap(),
                Err(RuntimeError::Cleanup(_))
            ));
            assert_eq!(owner.generation, generation, "poison must not re-register");
            owner.start_capture();
            assert!(owner.flight.is_none());
        }
    }

    #[test]
    fn shutdown_joins_real_failed_cancel_and_repeated_call_preserves_failure() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let cancelled = Arc::new(AtomicBool::new(false));
        let observed = cancelled.clone();
        let (commands, receiver) = mpsc::channel();
        let handle = thread::spawn(move || {
            let (mut owner, id) = owner(Route::Current);
            owner.flight.as_mut().unwrap().task = Some(CaptureTask::spawn(
                id,
                "main".into(),
                scope("original"),
                move |cancel| async move {
                    let _ = cancel.await;
                    observed.store(true, Ordering::SeqCst);
                    Err(HostError::CleanupFailed)
                },
            ));
            owner.run(receiver)
        });
        let runtime = AppshotsRuntime {
            commands,
            thread: Mutex::new(OwnerThread {
                handle: Some(handle),
                result: None,
            }),
        };
        for _ in 0..2 {
            assert!(matches!(runtime.shutdown(), Err(RuntimeError::Cleanup(_))));
            assert!(cancelled.load(Ordering::SeqCst));
        }
    }

    #[test]
    fn replacement_down_stops_before_target_read_when_old_task_cannot_be_reaped() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let (mut owner, id) = owner(Route::Current);
        let cancelled = Arc::new(AtomicBool::new(false));
        let observed = cancelled.clone();
        owner.flight.as_mut().unwrap().task = Some(CaptureTask::spawn(
            id,
            "main".into(),
            scope("original"),
            move |cancel| async move {
                let _ = cancel.await;
                observed.store(true, Ordering::SeqCst);
                Err(HostError::ReapFailed)
            },
        ));
        owner
            .controller
            .up(
                owner.generation,
                1,
                Destination::Automatic,
                owner.config.as_ref().unwrap().primary.as_ref(),
                now_ms(),
                false,
            )
            .unwrap();
        // A non-window sentinel is safe: poisoned replacement must return before
        // metadata lookup or worker construction can touch it.
        owner.native_event(EntryEvent::Down {
            input_epoch: 1,
            target: Ok(CaptureTarget {
                hwnd: 1,
                pid: 2,
                process_creation_time: 3,
            }),
        });
        assert!(cancelled.load(Ordering::SeqCst));
        assert!(owner.flight.is_none());
        assert!(matches!(owner.health(), Err(RuntimeError::Cleanup(_))));
        assert_eq!(owner.controller.state().registration, Registration::None);
    }
}
