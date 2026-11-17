//! Internal Windows entry state only. No system registration, foreground lookup,
//! renderer command or worker execution occurs here. Callers cancel and await
//! the worker belonging to every retired flight before reusing its resources.
use crate::appshots_host::CaptureTarget;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Hotkey {
    DoubleAlt,
    DoubleShift,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Destination {
    Automatic,
    LastChat,
    NewChat,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Route {
    Skip,
    Current,
    NewChat,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Registration {
    None,
    Pending,
    Ready,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Scope {
    pub account: String,
    pub composer: String,
}
#[derive(Clone)]
pub(crate) struct PrimaryWindow {
    pub is_primary: bool,
    pub alive: bool,
    pub can_accept: bool,
    pub focused: bool,
    pub last_active_ms: Option<u64>,
    pub is_new_chat: bool,
}
pub(crate) struct State {
    pub eligible: Option<bool>,
    pub supported: bool,
    pub configured_hotkey: Option<Hotkey>,
    pub registration: Registration,
    pub input_epoch: u64,
}
pub(crate) struct RegistrationChange {
    pub generation: u64,
    pub hotkey: Option<Hotkey>,
    pub retired: Option<Uuid>,
}
pub(crate) struct FlightStart {
    pub id: Uuid,
    pub retired: Option<Uuid>,
}

pub(crate) fn plan_route(
    destination: Destination,
    primary: Option<&PrimaryWindow>,
    now_ms: u64,
    work_allowed: bool,
) -> Route {
    let Some(p) = primary.filter(|p| p.is_primary && p.alive) else {
        return Route::Skip;
    };
    let current = p.can_accept
        && match destination {
            Destination::LastChat => true,
            Destination::NewChat => p.is_new_chat,
            Destination::Automatic => {
                p.focused
                    || p.last_active_ms
                        .is_some_and(|last| now_ms.saturating_sub(last) <= 60_000)
            }
        };
    if current {
        Route::Current
    } else if work_allowed {
        Route::NewChat
    } else {
        Route::Skip
    }
}

struct Flight {
    id: Uuid,
    target: CaptureTarget,
    owner: Option<(String, String)>,
    scope: Option<Scope>,
    released: bool,
    dispatched_down: bool,
    route_authorized: bool,
    started: bool,
}
impl Flight {
    fn owned(&self, id: Uuid, origin: &str, account: &str) -> bool {
        self.id == id
            && self
                .owner
                .as_ref()
                .is_some_and(|(o, a)| o == origin && a == account)
    }
    fn scoped(&self, id: Uuid, origin: &str, scope: &Scope) -> bool {
        self.owned(id, origin, &scope.account) && self.scope.as_ref() == Some(scope)
    }
}

pub(crate) struct Controller {
    eligible: Option<bool>,
    capable: bool,
    configured: Option<Hotkey>,
    registration: Registration,
    generation: u64,
    input_epoch: u64,
    pressed: bool,
    flight: Option<Flight>,
}
impl Default for Controller {
    fn default() -> Self {
        Self {
            eligible: None,
            capable: false,
            configured: Some(Hotkey::DoubleAlt),
            registration: Registration::None,
            generation: 0,
            input_epoch: 0,
            pressed: false,
            flight: None,
        }
    }
}
impl Controller {
    pub fn state(&self) -> State {
        State {
            eligible: self.eligible,
            supported: self.eligible == Some(true) && self.capable,
            configured_hotkey: self.configured,
            registration: self.registration,
            input_epoch: self.input_epoch,
        }
    }
    /// Start an explicit registration replacement, not an unchanged-state poll.
    /// None disables the preference; resolve an absent stored value to the Windows
    /// default before calling. Retired workers must be cancelled and awaited.
    pub fn reconcile(
        &mut self,
        eligible: Option<bool>,
        capable: bool,
        configured: Option<Hotkey>,
    ) -> RegistrationChange {
        let retired = self.retire();
        self.generation += 1;
        self.input_epoch = 0;
        self.eligible = eligible;
        self.capable = capable;
        self.configured = configured;
        let hotkey = configured.filter(|_| self.state().supported);
        self.registration = if hotkey.is_some() {
            Registration::Pending
        } else {
            Registration::None
        };
        RegistrationChange {
            generation: self.generation,
            hotkey,
            retired,
        }
    }
    /// Only the real native adapter's current registration ACK may call this.
    pub fn registration_ready(&mut self, generation: u64, input_epoch: u64) -> bool {
        if generation != self.generation
            || self.registration != Registration::Pending
            || input_epoch == 0
        {
            return false;
        }
        // Installed proves this registration, not the age of its input. A Reset
        // observed first must not be undone by a delayed installation ACK.
        self.input_epoch = self.input_epoch.max(input_epoch);
        self.registration = Registration::Ready;
        true
    }
    /// Reset may precede Installed, or follow Installed with the same epoch.
    /// Only a newer native epoch invalidates a flight. This does not stop workers:
    /// the owner must send cancellation and await the retired flight's task.
    pub fn input_reset(&mut self, generation: u64, input_epoch: u64) -> Option<Uuid> {
        if generation != self.generation
            || self.registration == Registration::None
            || input_epoch == 0
            || input_epoch <= self.input_epoch
        {
            return None;
        }
        self.input_epoch = input_epoch;
        self.retire()
    }
    /// Some(None) is a current failure without a flight; None is a stale event.
    pub fn registration_failed(&mut self, generation: u64) -> Option<Option<Uuid>> {
        if generation != self.generation || self.registration == Registration::None {
            return None;
        }
        self.registration = Registration::None;
        self.input_epoch = 0;
        self.capable = false;
        Some(self.retire())
    }
    pub fn retire(&mut self) -> Option<Uuid> {
        self.pressed = false;
        self.flight.take().map(|flight| flight.id)
    }
    /// Called only for the native adapter's proven simultaneous modifier down.
    /// target is already latched by that trusted adapter; never supplied by JS.
    pub fn down(
        &mut self,
        generation: u64,
        input_epoch: u64,
        target: CaptureTarget,
    ) -> Option<FlightStart> {
        if generation != self.generation
            || input_epoch == 0
            || input_epoch != self.input_epoch
            || self.registration != Registration::Ready
            || self.pressed
            || target.hwnd == 0
            || target.pid == 0
            || target.process_creation_time == 0
        {
            return None;
        }
        let retired = self.retire();
        let id = Uuid::new_v4();
        self.pressed = true;
        self.flight = Some(Flight {
            id,
            target,
            owner: None,
            scope: None,
            released: false,
            dispatched_down: false,
            route_authorized: false,
            started: false,
        });
        Some(FlightStart { id, retired })
    }
    pub fn route_down(
        &mut self,
        id: Uuid,
        destination: Destination,
        primary: Option<&PrimaryWindow>,
        now_ms: u64,
    ) -> Route {
        let Some(flight) = self
            .flight
            .as_mut()
            .filter(|f| f.id == id && !f.released && !f.dispatched_down)
        else {
            return Route::Skip;
        };
        if plan_route(destination, primary, now_ms, false) != Route::Current {
            return Route::Skip;
        }
        flight.dispatched_down = true;
        flight.route_authorized = true;
        Route::Current
    }
    pub fn up(
        &mut self,
        generation: u64,
        input_epoch: u64,
        destination: Destination,
        primary: Option<&PrimaryWindow>,
        now_ms: u64,
        work_allowed: bool,
    ) -> Option<(Uuid, Route)> {
        if generation != self.generation
            || input_epoch == 0
            || input_epoch != self.input_epoch
            || !self.pressed
        {
            return None;
        }
        self.pressed = false;
        let flight = self.flight.as_mut()?;
        flight.released = true;
        let route = if flight.dispatched_down {
            Route::Skip
        } else {
            plan_route(destination, primary, now_ms, work_allowed)
        };
        flight.route_authorized |= route != Route::Skip;
        Some((flight.id, route))
    }
    /// The first primary origin claims the flight; another origin cannot steal it.
    pub fn claim(&mut self, id: Uuid, origin: &str, account: &str) -> bool {
        if origin.is_empty() || account.is_empty() {
            return false;
        }
        let Some(flight) = self
            .flight
            .as_mut()
            .filter(|f| f.id == id && f.owner.is_none())
        else {
            return false;
        };
        flight.owner = Some((origin.to_owned(), account.to_owned()));
        true
    }
    /// Composer binding occurs after any authorized new-chat forwarding, once.
    pub fn consume(&mut self, id: Uuid, origin: &str, scope: &Scope) -> bool {
        if scope.composer.is_empty() {
            return false;
        }
        let Some(flight) = self.flight.as_mut().filter(|f| {
            f.owned(id, origin, &scope.account) && f.scope.is_none() && f.route_authorized
        }) else {
            return false;
        };
        flight.scope = Some(scope.clone());
        true
    }
    /// Caller waits for release; this returns only the original target once.
    pub fn start_capture(
        &mut self,
        id: Uuid,
        origin: &str,
        scope: &Scope,
    ) -> Option<CaptureTarget> {
        let flight = self
            .flight
            .as_mut()
            .filter(|f| f.scoped(id, origin, scope) && f.released && !f.started)?;
        flight.started = true;
        Some(flight.target)
    }
    /// A successful worker result is deliverable only to its still-current lease.
    pub fn complete(&mut self, id: Uuid, origin: &str, scope: &Scope) -> bool {
        if !self
            .flight
            .as_ref()
            .is_some_and(|f| f.scoped(id, origin, scope) && f.started)
        {
            return false;
        }
        self.retire();
        true
    }
    pub fn cancel(&mut self, id: Uuid, origin: &str, scope: &Scope) -> bool {
        if !self.flight.as_ref().is_some_and(|f| {
            f.owned(id, origin, &scope.account) && f.scope.as_ref().is_none_or(|s| s == scope)
        }) {
            return false;
        }
        self.retire();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(hwnd: u64) -> CaptureTarget {
        CaptureTarget {
            hwnd,
            pid: 42,
            process_creation_time: 123,
        }
    }
    fn scope(composer: &str) -> Scope {
        Scope {
            account: "account-a".into(),
            composer: composer.into(),
        }
    }
    fn primary() -> PrimaryWindow {
        PrimaryWindow {
            is_primary: true,
            alive: true,
            can_accept: true,
            focused: false,
            last_active_ms: Some(100),
            is_new_chat: false,
        }
    }
    fn ready() -> (Controller, u64) {
        let mut controller = Controller::default();
        let change = controller.reconcile(Some(true), true, Some(Hotkey::DoubleAlt));
        assert_eq!(controller.state().registration, Registration::Pending);
        assert!(controller.registration_ready(change.generation, 1));
        (controller, change.generation)
    }

    fn started(c: &mut Controller, generation: u64, epoch: u64) -> Uuid {
        let id = c.down(generation, epoch, target(7)).unwrap().id;
        assert!(c.claim(id, "window-a", "account-a"));
        assert_eq!(
            c.route_down(id, Destination::LastChat, Some(&primary()), 100),
            Route::Current
        );
        assert!(c.consume(id, "window-a", &scope("thread-a")));
        c.up(
            generation,
            epoch,
            Destination::LastChat,
            Some(&primary()),
            100,
            true,
        )
        .unwrap();
        c.start_capture(id, "window-a", &scope("thread-a")).unwrap();
        id
    }

    #[test]
    fn appshots_entry_reset_retires_consumed_or_running_capture_not_configuration() {
        for running in [false, true] {
            let (mut c, generation) = ready();
            let id = if running {
                started(&mut c, generation, 1)
            } else {
                let id = c.down(generation, 1, target(7)).unwrap().id;
                c.claim(id, "window-a", "account-a");
                c.route_down(id, Destination::LastChat, Some(&primary()), 100);
                assert!(c.consume(id, "window-a", &scope("thread-a")));
                id
            };
            assert_eq!(
                c.input_reset(generation, 2),
                Some(id),
                "owner must still cancel and await this retired worker"
            );
            assert_eq!(c.state().input_epoch, 2);
            assert_eq!(c.state().eligible, Some(true));
            assert!(c.state().supported);
            assert_eq!(c.state().configured_hotkey, Some(Hotkey::DoubleAlt));
            assert_eq!(c.state().registration, Registration::Ready);
            assert!(!c.consume(id, "window-a", &scope("thread-a")));
            assert!(c
                .start_capture(id, "window-a", &scope("thread-a"))
                .is_none());
            assert!(!c.complete(id, "window-a", &scope("thread-a")));
            assert!(c
                .up(
                    generation,
                    1,
                    Destination::LastChat,
                    Some(&primary()),
                    100,
                    true
                )
                .is_none());
            assert!(c.down(generation, 1, target(8)).is_none());
            let fresh = started(&mut c, generation, 2);
            assert_ne!(fresh, id);
            assert!(c.complete(fresh, "window-a", &scope("thread-a")));
        }
    }

    #[test]
    fn appshots_entry_duplicate_and_old_resets_cannot_kill_new_epoch_flight() {
        let (mut c, generation) = ready();
        c.input_reset(generation, 2);
        let fresh = started(&mut c, generation, 2);
        for (old_generation, old_epoch) in [
            (generation, 2),
            (generation, 1),
            (generation, 0),
            (generation - 1, 99),
        ] {
            assert_eq!(c.input_reset(old_generation, old_epoch), None);
            assert_eq!(c.state().input_epoch, 2);
        }
        assert!(c.complete(fresh, "window-a", &scope("thread-a")));
        let previous = started(&mut c, generation, 2);
        let next = c.reconcile(Some(true), true, Some(Hotkey::DoubleShift));
        assert_eq!(next.retired, Some(previous));
        assert!(c.registration_ready(next.generation, 1));
        let current = started(&mut c, next.generation, 1);
        assert_eq!(c.input_reset(generation, 100), None);
        assert!(c.complete(current, "window-a", &scope("thread-a")));
    }

    #[test]
    fn appshots_entry_installed_and_reset_order_preserves_latest_input_epoch() {
        for reset_before_installed in [false, true] {
            let mut c = Controller::default();
            let change = c.reconcile(Some(true), true, Some(Hotkey::DoubleAlt));
            assert!(!c.registration_ready(change.generation, 0));
            if reset_before_installed {
                assert_eq!(c.input_reset(change.generation, 3), None);
                assert_eq!(c.state().registration, Registration::Pending);
                assert!(c.registration_ready(change.generation, 3));
            } else {
                assert!(c.registration_ready(change.generation, 3));
            }
            let fresh = started(&mut c, change.generation, 3);
            assert_eq!(c.input_reset(change.generation, 3), None);
            assert!(c.complete(fresh, "window-a", &scope("thread-a")));
        }
        let mut c = Controller::default();
        let change = c.reconcile(Some(true), true, Some(Hotkey::DoubleAlt));
        c.input_reset(change.generation, 3);
        assert!(
            c.registration_ready(change.generation, 2),
            "same registration installation ACK cannot undo a newer reset"
        );
        assert_eq!(c.state().input_epoch, 3);
        assert!(c.down(change.generation, 2, target(1)).is_none());
        assert!(c.down(change.generation, 3, target(1)).is_some());
    }

    #[test]
    fn appshots_entry_queued_old_up_cannot_release_new_epoch_gesture() {
        let (mut c, generation) = ready();
        let old = c.down(generation, 1, target(7)).unwrap().id;
        assert_eq!(c.input_reset(generation, 2), Some(old));
        let fresh = c.down(generation, 2, target(8)).unwrap().id;
        c.claim(fresh, "window-a", "account-a");
        c.route_down(fresh, Destination::LastChat, Some(&primary()), 100);
        c.consume(fresh, "window-a", &scope("thread-a"));
        assert!(c
            .up(
                generation,
                1,
                Destination::LastChat,
                Some(&primary()),
                100,
                true
            )
            .is_none());
        assert!(c
            .start_capture(fresh, "window-a", &scope("thread-a"))
            .is_none());
        assert!(c
            .up(
                generation,
                2,
                Destination::LastChat,
                Some(&primary()),
                100,
                true
            )
            .is_some());
        assert_eq!(
            c.start_capture(fresh, "window-a", &scope("thread-a"))
                .unwrap()
                .hwnd,
            8
        );
    }

    #[test]
    fn appshots_entry_unknown_denied_and_unregistered_never_trigger() {
        let mut c = Controller::default();
        assert_eq!(c.state().eligible, None);
        assert!(!c.state().supported);
        for (eligible, capable, key) in [
            (None, true, Some(Hotkey::DoubleAlt)),
            (Some(false), true, Some(Hotkey::DoubleAlt)),
            (Some(true), false, Some(Hotkey::DoubleAlt)),
            (Some(true), true, None),
        ] {
            let change = c.reconcile(eligible, capable, key);
            assert_eq!(change.hotkey, None);
            assert!(!c.registration_ready(change.generation, 1));
            assert!(c.down(change.generation, 1, target(1)).is_none());
        }
        assert!(
            c.state().supported,
            "configured null disables registration, not host capability"
        );
        assert_eq!(c.state().configured_hotkey, None);
        let change = c.reconcile(Some(true), true, Some(Hotkey::DoubleShift));
        assert!(c.state().supported);
        assert!(
            c.down(change.generation, 1, target(1)).is_none(),
            "saved configuration is not a native ready ACK"
        );
    }

    #[test]
    fn appshots_entry_old_registration_events_cannot_retire_current_generation() {
        let (mut c, old) = ready();
        let first = c.down(old, 1, target(1)).unwrap();
        let change = c.reconcile(Some(true), true, Some(Hotkey::DoubleShift));
        assert_eq!(change.retired, Some(first.id));
        assert!(!c.registration_ready(old, 1));
        assert!(c.registration_failed(old).is_none());
        assert!(c.registration_ready(change.generation, 1));
        let current = c.down(change.generation, 1, target(2)).unwrap();
        assert!(c.down(old, 1, target(3)).is_none());
        assert!(c
            .up(old, 1, Destination::LastChat, Some(&primary()), 100, true)
            .is_none());
        assert_eq!(
            c.registration_failed(change.generation),
            Some(Some(current.id))
        );
        assert_eq!(c.state().registration, Registration::None);
        assert!(
            !c.state().supported,
            "failed native bridge is not a supported host until an explicit successful retry"
        );
        assert!(c.down(change.generation, 1, target(4)).is_none());
        let retry = c.reconcile(Some(true), true, Some(Hotkey::DoubleAlt));
        assert!(c.state().supported);
        assert_eq!(c.state().registration, Registration::Pending);
        assert!(c.registration_ready(retry.generation, 1));
    }

    #[test]
    fn appshots_entry_down_up_deduplicate_and_new_flight_retires_old() {
        let (mut c, generation) = ready();
        let first = c.down(generation, 1, target(1)).unwrap();
        assert!(c.down(generation, 1, target(2)).is_none());
        assert_eq!(
            c.route_down(first.id, Destination::LastChat, Some(&primary()), 100),
            Route::Current
        );
        assert_eq!(
            c.route_down(first.id, Destination::LastChat, Some(&primary()), 100),
            Route::Skip
        );
        assert_eq!(
            c.up(
                generation,
                1,
                Destination::LastChat,
                Some(&primary()),
                100,
                true
            ),
            Some((first.id, Route::Skip))
        );
        assert!(c
            .up(
                generation,
                1,
                Destination::LastChat,
                Some(&primary()),
                100,
                true
            )
            .is_none());
        let second = c.down(generation, 1, target(2)).unwrap();
        assert_eq!(second.retired, Some(first.id));
        assert_ne!(second.id, first.id);
    }

    #[test]
    fn appshots_entry_origin_account_composer_and_once_only_target_are_enforced() {
        let (mut c, generation) = ready();
        let flight = c.down(generation, 1, target(7)).unwrap().id;
        assert!(c.claim(flight, "window-a", "account-a"));
        assert!(!c.claim(flight, "window-b", "account-a"));
        c.route_down(flight, Destination::LastChat, Some(&primary()), 100);
        assert!(!c.consume(flight, "window-b", &scope("thread-a")));
        assert!(!c.consume(
            flight,
            "window-a",
            &Scope {
                account: "other".into(),
                composer: "thread-a".into()
            }
        ));
        // Route forwarding may select a new Composer before the first consume.
        assert!(c.consume(flight, "window-a", &scope("new-thread")));
        assert!(!c.consume(flight, "window-a", &scope("new-thread")));
        assert!(
            c.start_capture(flight, "window-a", &scope("new-thread"))
                .is_none(),
            "wait for physical release"
        );
        c.up(
            generation,
            1,
            Destination::LastChat,
            Some(&primary()),
            100,
            true,
        );
        assert!(c
            .start_capture(flight, "window-a", &scope("other-thread"))
            .is_none());
        assert!(c
            .start_capture(flight, "window-b", &scope("new-thread"))
            .is_none());
        let locked = c
            .start_capture(flight, "window-a", &scope("new-thread"))
            .unwrap();
        assert_eq!(
            (locked.hwnd, locked.pid, locked.process_creation_time),
            (7, 42, 123)
        );
        assert!(c
            .start_capture(flight, "window-a", &scope("new-thread"))
            .is_none());
        assert!(!c.complete(flight, "window-b", &scope("new-thread")));
        assert!(!c.cancel(flight, "window-a", &scope("other-thread")));
        assert!(c.complete(flight, "window-a", &scope("new-thread")));
        assert!(!c.complete(flight, "window-a", &scope("new-thread")));
    }

    #[test]
    fn appshots_entry_cancel_and_retire_reject_late_capture_results() {
        let (mut c, generation) = ready();
        for cancel in [true, false] {
            let id = c.down(generation, 1, target(1)).unwrap().id;
            c.claim(id, "window-a", "account-a");
            c.route_down(id, Destination::LastChat, Some(&primary()), 100);
            c.consume(id, "window-a", &scope("thread-a"));
            c.up(
                generation,
                1,
                Destination::LastChat,
                Some(&primary()),
                100,
                true,
            );
            c.start_capture(id, "window-a", &scope("thread-a")).unwrap();
            if cancel {
                assert!(c.cancel(id, "window-a", &scope("thread-a")));
            } else {
                assert_eq!(c.retire(), Some(id));
            }
            assert!(!c.complete(id, "window-a", &scope("thread-a")));
            assert!(c
                .start_capture(id, "window-a", &scope("thread-a"))
                .is_none());
        }
    }

    #[test]
    fn appshots_entry_intro_cancel_never_exposes_or_starts_the_locked_target() {
        let (mut c, generation) = ready();
        let id = c.down(generation, 1, target(1)).unwrap().id;
        c.claim(id, "window-a", "account-a");
        assert!(c.cancel(id, "window-a", &scope("thread-a")));
        assert!(!c.consume(id, "window-a", &scope("thread-a")));
        assert!(c
            .start_capture(id, "window-a", &scope("thread-a"))
            .is_none());
        assert!(c
            .up(
                generation,
                1,
                Destination::LastChat,
                Some(&primary()),
                100,
                true
            )
            .is_none());
    }

    #[test]
    fn appshots_entry_automatic_focus_includes_exact_sixty_seconds() {
        let mut p = primary();
        for (elapsed, route) in [
            (59_999, Route::Current),
            (60_000, Route::Current),
            (60_001, Route::NewChat),
        ] {
            assert_eq!(
                plan_route(Destination::Automatic, Some(&p), 100 + elapsed, true),
                route
            );
        }
        p.focused = true;
        assert_eq!(
            plan_route(Destination::Automatic, Some(&p), 999_999, false),
            Route::Current
        );
        p.focused = false;
        p.last_active_ms = None;
        assert_eq!(
            plan_route(Destination::Automatic, Some(&p), 100, false),
            Route::Skip
        );
        p.last_active_ms = Some(200);
        assert_eq!(
            plan_route(Destination::Automatic, Some(&p), 100, true),
            Route::Current,
            "source wall clock comparison permits a backwards clock"
        );
    }

    #[test]
    fn appshots_entry_denied_new_chat_route_cannot_consume_target() {
        let (mut c, generation) = ready();
        let id = c.down(generation, 1, target(1)).unwrap().id;
        c.claim(id, "window-a", "account-a");
        assert!(
            !c.consume(id, "window-a", &scope("thread-a")),
            "claim is not route authorization"
        );
        assert_eq!(
            c.route_down(id, Destination::NewChat, Some(&primary()), 100),
            Route::Skip
        );
        assert_eq!(
            c.up(
                generation,
                1,
                Destination::NewChat,
                Some(&primary()),
                100,
                false
            ),
            Some((id, Route::Skip))
        );
        assert!(!c.consume(id, "window-a", &scope("thread-a")));
        assert!(c
            .start_capture(id, "window-a", &scope("thread-a"))
            .is_none());
    }

    #[test]
    fn appshots_entry_routes_require_primary_acceptance_and_work_access_for_new_chat() {
        let mut p = primary();
        assert_eq!(
            plan_route(Destination::LastChat, None, 100, true),
            Route::Skip
        );
        p.alive = false;
        assert_eq!(
            plan_route(Destination::LastChat, Some(&p), 100, true),
            Route::Skip
        );
        p.alive = true;
        p.is_primary = false;
        assert_eq!(
            plan_route(Destination::LastChat, Some(&p), 100, true),
            Route::Skip
        );
        p.is_primary = true;
        p.can_accept = false;
        assert_eq!(
            plan_route(Destination::LastChat, Some(&p), 100, false),
            Route::Skip
        );
        assert_eq!(
            plan_route(Destination::LastChat, Some(&p), 100, true),
            Route::NewChat
        );
        p.can_accept = true;
        assert_eq!(
            plan_route(Destination::LastChat, Some(&p), 999_999, false),
            Route::Current
        );
        assert_eq!(
            plan_route(Destination::NewChat, Some(&p), 100, false),
            Route::Skip
        );
        assert_eq!(
            plan_route(Destination::NewChat, Some(&p), 100, true),
            Route::NewChat
        );
        p.is_new_chat = true;
        assert_eq!(
            plan_route(Destination::NewChat, Some(&p), 100, false),
            Route::Current
        );
    }
}
