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
    pub capture_generation: u64,
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
        capture_generation: u64,
        scope: Scope,
        origin: String,
        route: Route,
        metadata: TargetMetadata,
    },
    CaptureReady {
        id: Uuid,
        capture_generation: u64,
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
    NativeStart(u32),
    Cleanup(Arc<HostError>),
}

pub(crate) struct HandoffContext {
    pub from: Scope,
    pub from_capture_generation: u64,
    pub to: Scope,
    pub capture_generation: u64,
    pub can_accept: bool,
    pub is_new_chat: bool,
}

enum Command {
    HandoffCurrent(
        Uuid,
        String,
        Scope,
        u64,
        mpsc::Sender<Result<bool, RuntimeError>>,
    ),
    ClaimRoute(
        Uuid,
        String,
        Scope,
        mpsc::Sender<Result<Option<Route>, RuntimeError>>,
    ),
    HandoffContext(
        Uuid,
        String,
        HandoffContext,
        mpsc::Sender<Result<bool, RuntimeError>>,
    ),
    ReadState(mpsc::Sender<Result<State, RuntimeError>>),
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
    pub fn state(&self) -> Result<State, RuntimeError> {
        self.request(Command::ReadState)
    }
    pub fn claim(&self, id: Uuid, origin: String, scope: Scope) -> Result<bool, RuntimeError> {
        self.request(|reply| Command::Claim(id, origin, scope, reply))
    }
    pub fn claim_route(
        &self,
        id: Uuid,
        origin: String,
        scope: Scope,
    ) -> Result<Option<Route>, RuntimeError> {
        self.request(|reply| Command::ClaimRoute(id, origin, scope, reply))
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
    pub fn handoff_context(
        &self,
        id: Uuid,
        origin: String,
        context: HandoffContext,
    ) -> Result<bool, RuntimeError> {
        self.request(|reply| Command::HandoffContext(id, origin, context, reply))
    }
    pub fn handoff_current(
        &self,
        id: Uuid,
        origin: String,
        scope: Scope,
        capture_generation: u64,
    ) -> Result<bool, RuntimeError> {
        self.request(|reply| Command::HandoffCurrent(id, origin, scope, capture_generation, reply))
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
    capture_generation: u64,
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
    #[cfg(test)]
    native_start_error: Option<u32>,
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
            #[cfg(test)]
            native_start_error: None,
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
        let context_changed = self.config.as_ref().is_some_and(|old| {
            old.scope != config.scope
                || old.origin != config.origin
                || old.capture_generation != config.capture_generation
                || old
                    .primary
                    .as_ref()
                    .map(|p| (p.is_primary, p.alive, p.can_accept, p.is_new_chat))
                    != config
                        .primary
                        .as_ref()
                        .map(|p| (p.is_primary, p.alive, p.can_accept, p.is_new_chat))
        });
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
                #[cfg(test)]
                let started = self
                    .native_start_error
                    .map_or_else(|| NativeEntry::start(hotkey), Err);
                #[cfg(not(test))]
                let started = NativeEntry::start(hotkey);
                match started {
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
                        self.config = Some(config);
                        self.state();
                        return Err(RuntimeError::NativeStart(code));
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
                && self
                    .config
                    .as_ref()
                    .is_some_and(|config| config.capture_generation == f.capture_generation)
        })
    }

    fn claim(&mut self, id: Uuid, origin: &str, scope: &Scope) -> bool {
        let accepted =
            self.matches(id, origin, scope) && self.controller.claim(id, origin, &scope.account);
        if accepted {
            self.flight.as_mut().unwrap().claimed = true;
        }
        accepted
    }

    fn handoff(&mut self, id: Uuid, origin: &str, context: HandoffContext) -> bool {
        let accepted = self.matches(id, origin, &context.from)
            && self.config.as_ref().is_some_and(|config| {
                config.work_allowed == Some(true)
                    && config.capture_generation == context.from_capture_generation
                    && config
                        .primary
                        .as_ref()
                        .is_some_and(|primary| primary.is_primary && primary.alive)
            })
            && context.from.account == context.to.account
            && !context.to.composer.is_empty()
            && context.can_accept
            && context.is_new_chat
            && self.flight.as_ref().is_some_and(|flight| {
                flight.claimed
                    && !flight.reserved
                    && !flight.accepted
                    && !flight.handed_off
                    && flight.route == Route::NewChat
            });
        if accepted {
            let flight = self.flight.as_mut().unwrap();
            flight.scope = context.to.clone();
            flight.capture_generation = context.capture_generation;
            flight.handed_off = true;
            let config = self.config.as_mut().unwrap();
            config.scope = context.to;
            config.capture_generation = context.capture_generation;
            let primary = config.primary.as_mut().unwrap();
            primary.can_accept = context.can_accept;
            primary.is_new_chat = context.is_new_chat;
        }
        accepted
    }

    fn command(&mut self, command: Command) {
        self.check_epoch();
        if let Err(error) = self.health() {
            match command {
                Command::Configure(_, reply) | Command::ReadState(reply) => {
                    let _ = reply.send(Err(error));
                }
                Command::Claim(_, _, _, reply)
                | Command::Reserve(_, _, _, reply)
                | Command::Commit(_, _, _, reply)
                | Command::Decline(_, _, _, reply)
                | Command::Handoff(_, _, _, _, reply) => {
                    let _ = reply.send(Err(error));
                }
                Command::HandoffContext(_, _, _, reply) => {
                    let _ = reply.send(Err(error));
                }
                Command::ClaimRoute(_, _, _, reply) => {
                    let _ = reply.send(Err(error));
                }
                Command::HandoffCurrent(_, _, _, _, reply) => {
                    let _ = reply.send(Err(error));
                }
                Command::Shutdown => {}
            }
            return;
        }
        match command {
            Command::HandoffCurrent(id, origin, scope, generation, reply) => {
                let current = self.matches(id, &origin, &scope)
                    && self.flight.as_ref().is_some_and(|flight| {
                        flight.handed_off
                            && flight.claimed
                            && !flight.reserved
                            && !flight.accepted
                            && flight.capture_generation == generation
                    });
                let _ = reply.send(Ok(current));
            }
            Command::HandoffContext(id, origin, context, reply) => {
                let accepted = self.handoff(id, &origin, context);
                let _ = reply.send(Ok(accepted));
            }
            Command::ClaimRoute(id, origin, scope, reply) => {
                let route = self
                    .claim(id, &origin, &scope)
                    .then(|| self.flight.as_ref().unwrap().route);
                let _ = reply.send(Ok(route));
            }
            Command::ReadState(reply) => {
                let _ = reply.send(Ok(self.controller.state()));
            }
            Command::Configure(config, reply) => {
                let result = self.configure(config);
                let _ = reply.send(result);
            }
            Command::Claim(id, origin, scope, reply) => {
                let accepted = self.claim(id, &origin, &scope);
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
                let generation = self
                    .config
                    .as_ref()
                    .map_or(0, |config| config.capture_generation);
                let accepted = self.handoff(
                    id,
                    &origin,
                    HandoffContext {
                        from,
                        from_capture_generation: generation,
                        to,
                        capture_generation: generation,
                        can_accept: true,
                        is_new_chat: true,
                    },
                );
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
                capture_generation: flight.capture_generation,
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
                    capture_generation: config.capture_generation,
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
                    capture_generation: flight.capture_generation,
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
            capture_generation: 1,
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
    #[test]
    fn hotkey_sync_native_start_failure_is_typed_and_can_restore_disabled_configuration() {
        let mut owner = Owner::new(PathBuf::new(), Box::new(|_| {}));
        owner.native_start_error = Some(87);
        let mut old = config();
        old.hotkey = None;
        owner.configure(old.clone()).unwrap();
        assert!(matches!(
            owner.configure(config()),
            Err(RuntimeError::NativeStart(87))
        ));
        assert_eq!(owner.controller.state().registration, Registration::None);
        owner.configure(old).unwrap();
        assert_eq!(owner.config.as_ref().unwrap().hotkey, None);
    }

    #[test]
    fn late_native_failure_keeps_committed_configuration_and_read_state_does_not_reconfigure() {
        let mut owner = Owner::new(PathBuf::new(), Box::new(|_| {}));
        owner.config = Some(config());
        let change = owner
            .controller
            .reconcile(Some(true), true, Some(Hotkey::DoubleAlt));
        owner.generation = change.generation;
        owner.native_event(EntryEvent::Failed(5));
        assert_eq!(
            owner.config.as_ref().unwrap().hotkey,
            Some(Hotkey::DoubleAlt)
        );
        let generation = owner.generation;
        let (send, receive) = mpsc::channel();
        owner.command(Command::ReadState(send));
        assert_eq!(
            receive.recv().unwrap().unwrap().registration,
            Registration::None
        );
        assert_eq!(owner.generation, generation);
        assert!(owner.native.is_none());
    }

    #[test]
    fn destination_only_refresh_keeps_registration_generation_and_native_choice() {
        let mut owner = Owner::new(PathBuf::new(), Box::new(|_| {}));
        let mut initial = config();
        initial.hotkey = None;
        owner.configure(initial.clone()).unwrap();
        let generation = owner.generation;
        initial.destination = Destination::NewChat;
        owner.configure(initial).unwrap();
        assert_eq!(owner.generation, generation);
        assert_eq!(
            owner.config.as_ref().unwrap().destination,
            Destination::NewChat
        );
        assert!(owner.native.is_none());
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
            capture_generation: 1,
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
    fn ordinary_consumer_generation_and_routing_updates_retire_tasks_without_reregistering() {
        use std::sync::atomic::{AtomicBool, Ordering};
        for change in ["generation", "scope", "can-accept", "new-chat"] {
            let (mut owner, id) = owner(Route::Current);
            assert!(boolean(&mut owner, |reply| Command::Claim(
                id,
                "main".into(),
                scope("original"),
                reply
            )));
            let cancelled = Arc::new(AtomicBool::new(false));
            let observed = cancelled.clone();
            owner.flight.as_mut().unwrap().task = Some(CaptureTask::spawn(
                id,
                "main".into(),
                scope("original"),
                move |cancel| async move {
                    let _ = cancel.await;
                    observed.store(true, Ordering::SeqCst);
                    Err(HostError::Cancelled)
                },
            ));
            let generation = owner.generation;
            let mut next = config();
            match change {
                "generation" => next.capture_generation += 1,
                "scope" => next.scope = scope("next"),
                "can-accept" => next.primary.as_mut().unwrap().can_accept = false,
                _ => next.primary.as_mut().unwrap().is_new_chat = true,
            }
            owner.configure(next).unwrap();
            let retired = owner.flight.is_none();
            // The red implementation must also cancel/join its private mock
            // task before assertion, rather than leaving background work alive.
            if !retired {
                owner.retire();
            }
            assert!(cancelled.load(Ordering::SeqCst));
            assert!(
                retired,
                "consumer {change} changed but retained the old flight"
            );
            assert_eq!(owner.generation, generation);
            assert_eq!(owner.controller.state().registration, Registration::Ready);
        }
    }

    #[test]
    fn focus_and_last_active_updates_keep_the_current_claim_and_registration() {
        let (mut owner, id) = owner(Route::Current);
        assert!(boolean(&mut owner, |reply| Command::Claim(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        let generation = owner.generation;
        let mut next = config();
        let primary = next.primary.as_mut().unwrap();
        primary.focused = false;
        primary.last_active_ms = Some(123);
        owner.configure(next).unwrap();
        assert!(owner
            .flight
            .as_ref()
            .is_some_and(|flight| flight.id == id && flight.claimed));
        assert_eq!(owner.generation, generation);
        assert_eq!(owner.controller.state().registration, Registration::Ready);
    }

    #[test]
    fn same_scope_generation_aba_cannot_restore_retired_claim_or_capture() {
        let (mut owner, id) = owner(Route::Current);
        assert!(boolean(&mut owner, |reply| Command::Claim(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
        let generation = owner.generation;
        let mut next = config();
        next.capture_generation = 0;
        owner.configure(next).unwrap();
        owner.configure(config()).unwrap();
        assert_eq!(owner.generation, generation);
        assert!(!boolean(&mut owner, |reply| Command::Claim(
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
        assert!(!boolean(&mut owner, |reply| Command::Commit(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
    }

    #[test]
    fn route_and_completed_capture_emit_the_flights_original_capture_generation() {
        let (mut owner, id) = owner(Route::Current);
        let tags = Arc::new(Mutex::new(Vec::new()));
        let emitted = tags.clone();
        owner.emit = Box::new(move |event| match event {
            RuntimeEvent::Route {
                capture_generation, ..
            } => emitted.lock().unwrap().push(("route", capture_generation)),
            RuntimeEvent::CaptureReady {
                capture_generation, ..
            } => emitted
                .lock()
                .unwrap()
                .push(("capture", capture_generation)),
            _ => {}
        });
        owner.dispatch();
        assert!(boolean(&mut owner, |reply| Command::Claim(
            id,
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
        assert!(boolean(&mut owner, |reply| Command::Commit(
            id,
            "main".into(),
            scope("original"),
            reply
        )));
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
        assert!(owner
            .controller
            .start_capture(id, "main", &scope("original"))
            .is_some());
        owner.flight.as_mut().unwrap().task = Some(CaptureTask::spawn(
            id,
            "main".into(),
            scope("original"),
            |_| async move {
                Ok(HostCapture {
                    request_id: id.to_string(),
                    png: Vec::new(),
                    capture: crate::appshots_worker::WorkerCapture {
                        width: 1,
                        height: 1,
                        text_status: crate::appshots_worker::TextStatus::Unavailable,
                        text_source: crate::appshots_worker::TextSource::None,
                        text: None,
                    },
                })
            },
        ));
        // This is an injected completed result, not a native capture or image
        // validity test. Await its task before invoking the real finish path.
        let deadline = Instant::now() + Duration::from_secs(2);
        while !owner
            .flight
            .as_ref()
            .unwrap()
            .task
            .as_ref()
            .unwrap()
            .is_finished()
        {
            assert!(Instant::now() < deadline);
            thread::yield_now();
        }
        owner.finish();
        assert_eq!(*tags.lock().unwrap(), vec![("route", 1), ("capture", 1)]);
    }

    #[test]
    fn consumer_generation_update_preserves_cleanup_poison() {
        let (mut owner, id) = owner(Route::Current);
        owner.flight.as_mut().unwrap().task = Some(CaptureTask::spawn(
            id,
            "main".into(),
            scope("original"),
            |cancel| async move {
                let _ = cancel.await;
                Err(HostError::CleanupFailed)
            },
        ));
        let mut next = config();
        next.capture_generation += 1;
        assert!(matches!(
            owner.configure(next),
            Err(RuntimeError::Cleanup(_))
        ));
        assert!(matches!(
            owner.configure(config()),
            Err(RuntimeError::Cleanup(_))
        ));
        assert!(owner.poison.is_some());
        assert!(owner.flight.is_none());
        assert!(owner.native.is_none());
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
    fn new_chat_same_home_handoff_preserves_original_target_and_single_consumption() {
        let (mut owner, id) = owner(Route::NewChat);
        let home = scope("home");
        owner.config.as_mut().unwrap().scope = home.clone();
        owner.flight.as_mut().unwrap().scope = home.clone();
        let metadata = owner.flight.as_ref().unwrap().metadata.clone();
        assert!(boolean(&mut owner, |reply| Command::Claim(
            id,
            "main".into(),
            home.clone(),
            reply
        )));
        // An unchanged home client key does not supply Work permission.
        assert!(!boolean(&mut owner, |reply| Command::Handoff(
            id,
            "main".into(),
            home.clone(),
            home.clone(),
            reply
        )));
        owner.config.as_mut().unwrap().work_allowed = Some(true);
        let foreign = Scope {
            account: "other-account".into(),
            composer: "home".into(),
        };
        assert!(!boolean(&mut owner, |reply| Command::Handoff(
            id,
            "main".into(),
            home.clone(),
            foreign,
            reply
        )));
        assert!(!boolean(&mut owner, |reply| Command::Handoff(
            id,
            "main".into(),
            scope("wrong-home"),
            home.clone(),
            reply
        )));
        assert!(
            boolean(&mut owner, |reply| Command::Handoff(
                id,
                "main".into(),
                home.clone(),
                home.clone(),
                reply
            )),
            "explicit Work handoff can reuse the existing home draft scope"
        );
        assert!(!boolean(&mut owner, |reply| Command::Handoff(
            id,
            "main".into(),
            home.clone(),
            home.clone(),
            reply
        )));
        assert_eq!(owner.flight.as_ref().unwrap().metadata, metadata);
        assert!(boolean(&mut owner, |reply| Command::Reserve(
            id,
            "main".into(),
            home.clone(),
            reply
        )));
        assert!(boolean(&mut owner, |reply| Command::Commit(
            id,
            "main".into(),
            home.clone(),
            reply
        )));
        // Still held: commit must not start a real capture worker in this test.
        assert!(owner.flight.as_ref().unwrap().task.is_none());
        assert!(!boolean(&mut owner, |reply| Command::Commit(
            id,
            "main".into(),
            home.clone(),
            reply
        )));
        owner
            .controller
            .up(
                owner.generation,
                1,
                Destination::Automatic,
                owner.config.as_ref().unwrap().primary.as_ref(),
                now_ms(),
                true,
            )
            .unwrap();
        let target = owner.controller.start_capture(id, "main", &home).unwrap();
        assert_eq!(
            (target.hwnd, target.pid, target.process_creation_time),
            (1, 2, 3)
        );
        assert!(owner.controller.start_capture(id, "main", &home).is_none());
    }

    #[test]
    fn atomic_work_handoff_moves_generation_and_home_flags_without_replacing_target() {
        for same_home in [false, true] {
            let (mut owner, id) = owner(Route::NewChat);
            let from = if same_home {
                scope("home")
            } else {
                scope("original")
            };
            owner.config.as_mut().unwrap().scope = from.clone();
            owner.config.as_mut().unwrap().capture_generation = 10;
            owner.config.as_mut().unwrap().work_allowed = Some(true);
            owner.flight.as_mut().unwrap().scope = from.clone();
            owner.flight.as_mut().unwrap().capture_generation = 10;
            let metadata = owner.flight.as_ref().unwrap().metadata.clone();
            let generation = owner.generation;
            assert!(boolean(&mut owner, |reply| Command::Claim(
                id,
                "main".into(),
                from.clone(),
                reply
            )));
            assert!(
                boolean(&mut owner, |reply| Command::HandoffContext(
                    id,
                    "main".into(),
                    HandoffContext {
                        from: from.clone(),
                        from_capture_generation: 10,
                        to: scope("home"),
                        capture_generation: 0,
                        can_accept: true,
                        is_new_chat: true,
                    },
                    reply
                )),
                "claimed Work flight requires an atomic home handoff"
            );
            assert_eq!(owner.config.as_ref().unwrap().capture_generation, 0);
            assert_eq!(owner.flight.as_ref().unwrap().capture_generation, 0);
            assert!(
                owner
                    .config
                    .as_ref()
                    .unwrap()
                    .primary
                    .as_ref()
                    .unwrap()
                    .is_new_chat
            );
            assert_eq!(owner.generation, generation);
            assert_eq!(owner.controller.state().registration, Registration::Ready);
            assert_eq!(owner.flight.as_ref().unwrap().metadata, metadata);
            assert!(boolean(&mut owner, |reply| Command::Reserve(
                id,
                "main".into(),
                scope("home"),
                reply
            )));
            assert!(boolean(&mut owner, |reply| Command::Commit(
                id,
                "main".into(),
                scope("home"),
                reply
            )));
            assert!(owner.flight.as_ref().unwrap().task.is_none());
            owner
                .controller
                .up(
                    owner.generation,
                    1,
                    Destination::NewChat,
                    owner.config.as_ref().unwrap().primary.as_ref(),
                    now_ms(),
                    true,
                )
                .unwrap();
            let original = owner
                .controller
                .start_capture(id, "main", &scope("home"))
                .unwrap();
            assert_eq!(
                (original.hwnd, original.pid, original.process_creation_time),
                (1, 2, 3)
            );
            assert!(owner
                .controller
                .start_capture(id, "main", &scope("home"))
                .is_none());
        }
    }

    #[test]
    fn atomic_work_handoff_rejects_unready_permission_and_stale_source_without_mutation() {
        for scenario in [
            "unknown",
            "denied",
            "unclaimed",
            "reserved",
            "accepted",
            "repeated",
            "source-generation",
            "source-scope",
            "target-account",
            "origin",
            "unready",
            "not-home",
        ] {
            let (mut owner, id) = owner(Route::NewChat);
            owner.config.as_mut().unwrap().work_allowed = Some(true);
            if scenario != "unclaimed" {
                assert!(boolean(&mut owner, |reply| Command::Claim(
                    id,
                    "main".into(),
                    scope("original"),
                    reply
                )));
            }
            let mut context = HandoffContext {
                from: scope("original"),
                from_capture_generation: 1,
                to: scope("home"),
                capture_generation: 0,
                can_accept: true,
                is_new_chat: true,
            };
            match scenario {
                "unknown" => owner.config.as_mut().unwrap().work_allowed = None,
                "denied" => owner.config.as_mut().unwrap().work_allowed = Some(false),
                "reserved" => owner.flight.as_mut().unwrap().reserved = true,
                "accepted" => owner.flight.as_mut().unwrap().accepted = true,
                "repeated" => owner.flight.as_mut().unwrap().handed_off = true,
                "source-generation" => context.from_capture_generation = 9,
                "source-scope" => context.from = scope("foreign"),
                "target-account" => context.to.account = "foreign-account".into(),
                "unready" => context.can_accept = false,
                "not-home" => context.is_new_chat = false,
                _ => {}
            }
            assert!(
                !boolean(&mut owner, |reply| Command::HandoffContext(
                    id,
                    if scenario == "origin" {
                        "other".into()
                    } else {
                        "main".into()
                    },
                    context,
                    reply
                )),
                "{scenario}"
            );
            assert_eq!(owner.config.as_ref().unwrap().scope, scope("original"));
            assert_eq!(owner.flight.as_ref().unwrap().scope, scope("original"));
            assert_eq!(owner.config.as_ref().unwrap().capture_generation, 1);
            assert_eq!(owner.flight.as_ref().unwrap().capture_generation, 1);
        }
    }

    #[test]
    fn atomic_handoff_late_receipt_and_ordinary_context_update_cannot_keep_the_old_flight() {
        for invalidate in ["epoch", "context"] {
            let (mut owner, id) = owner(Route::NewChat);
            owner.config.as_mut().unwrap().work_allowed = Some(true);
            assert!(boolean(&mut owner, |reply| Command::Claim(
                id,
                "main".into(),
                scope("original"),
                reply
            )));
            assert!(boolean(&mut owner, |reply| Command::HandoffContext(
                id,
                "main".into(),
                HandoffContext {
                    from: scope("original"),
                    from_capture_generation: 1,
                    to: scope("home"),
                    capture_generation: 0,
                    can_accept: true,
                    is_new_chat: true,
                },
                reply
            )));
            assert!(boolean(&mut owner, |reply| Command::HandoffCurrent(
                id,
                "main".into(),
                scope("home"),
                0,
                reply
            )));
            assert!(!boolean(&mut owner, |reply| Command::HandoffContext(
                id,
                "main".into(),
                HandoffContext {
                    from: scope("home"),
                    from_capture_generation: 0,
                    to: scope("home"),
                    capture_generation: 0,
                    can_accept: true,
                    is_new_chat: true,
                },
                reply
            )));
            if invalidate == "epoch" {
                owner.observe_epoch(2);
            } else {
                let mut next = owner.config.as_ref().unwrap().clone();
                next.capture_generation = 2;
                owner.configure(next).unwrap();
            }
            assert!(!boolean(&mut owner, |reply| Command::HandoffCurrent(
                id,
                "main".into(),
                scope("home"),
                0,
                reply
            )));
            assert!(owner.flight.is_none());
        }
    }

    #[test]
    fn claimed_route_is_returned_atomically_without_creating_capture_or_reclaiming() {
        for route in [Route::Current, Route::NewChat] {
            let (mut owner, id) = owner(route);
            let (send, receive) = mpsc::channel();
            owner.command(Command::ClaimRoute(
                id,
                "main".into(),
                scope("original"),
                send,
            ));
            assert_eq!(receive.recv().unwrap().unwrap(), Some(route));
            let (send, receive) = mpsc::channel();
            owner.command(Command::ClaimRoute(
                id,
                "main".into(),
                scope("original"),
                send,
            ));
            assert_eq!(receive.recv().unwrap().unwrap(), None);
            assert!(owner.flight.as_ref().unwrap().task.is_none());
        }
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
