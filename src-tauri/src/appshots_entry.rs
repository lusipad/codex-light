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
    pub fn registration_ready(&mut self, generation: u64) -> bool {
        if generation != self.generation || self.registration != Registration::Pending {
            return false;
        }
        self.registration = Registration::Ready;
        true
    }
    /// Some(None) is a current failure without a flight; None is a stale event.
    pub fn registration_failed(&mut self, generation: u64) -> Option<Option<Uuid>> {
        if generation != self.generation || self.registration == Registration::None {
            return None;
        }
        self.registration = Registration::None;
        self.capable = false;
        Some(self.retire())
    }
    pub fn retire(&mut self) -> Option<Uuid> {
        self.pressed = false;
        self.flight.take().map(|flight| flight.id)
    }
    /// Called only for the native adapter's proven simultaneous modifier down.
    /// target is already latched by that trusted adapter; never supplied by JS.
    pub fn down(&mut self, generation: u64, target: CaptureTarget) -> Option<FlightStart> {
        if generation != self.generation
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
        destination: Destination,
        primary: Option<&PrimaryWindow>,
        now_ms: u64,
        work_allowed: bool,
    ) -> Option<(Uuid, Route)> {
        if generation != self.generation || !self.pressed {
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
        assert!(controller.registration_ready(change.generation));
        (controller, change.generation)
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
            assert!(!c.registration_ready(change.generation));
            assert!(c.down(change.generation, target(1)).is_none());
        }
        assert!(
            c.state().supported,
            "configured null disables registration, not host capability"
        );
        assert_eq!(c.state().configured_hotkey, None);
        let change = c.reconcile(Some(true), true, Some(Hotkey::DoubleShift));
        assert!(c.state().supported);
        assert!(
            c.down(change.generation, target(1)).is_none(),
            "saved configuration is not a native ready ACK"
        );
    }

    #[test]
    fn appshots_entry_old_registration_events_cannot_retire_current_generation() {
        let (mut c, old) = ready();
        let first = c.down(old, target(1)).unwrap();
        let change = c.reconcile(Some(true), true, Some(Hotkey::DoubleShift));
        assert_eq!(change.retired, Some(first.id));
        assert!(!c.registration_ready(old));
        assert!(c.registration_failed(old).is_none());
        assert!(c.registration_ready(change.generation));
        let current = c.down(change.generation, target(2)).unwrap();
        assert!(c.down(old, target(3)).is_none());
        assert!(c
            .up(old, Destination::LastChat, Some(&primary()), 100, true)
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
        assert!(c.down(change.generation, target(4)).is_none());
        let retry = c.reconcile(Some(true), true, Some(Hotkey::DoubleAlt));
        assert!(c.state().supported);
        assert_eq!(c.state().registration, Registration::Pending);
        assert!(c.registration_ready(retry.generation));
    }

    #[test]
    fn appshots_entry_down_up_deduplicate_and_new_flight_retires_old() {
        let (mut c, generation) = ready();
        let first = c.down(generation, target(1)).unwrap();
        assert!(c.down(generation, target(2)).is_none());
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
                Destination::LastChat,
                Some(&primary()),
                100,
                true
            )
            .is_none());
        let second = c.down(generation, target(2)).unwrap();
        assert_eq!(second.retired, Some(first.id));
        assert_ne!(second.id, first.id);
    }

    #[test]
    fn appshots_entry_origin_account_composer_and_once_only_target_are_enforced() {
        let (mut c, generation) = ready();
        let flight = c.down(generation, target(7)).unwrap().id;
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
            let id = c.down(generation, target(1)).unwrap().id;
            c.claim(id, "window-a", "account-a");
            c.route_down(id, Destination::LastChat, Some(&primary()), 100);
            c.consume(id, "window-a", &scope("thread-a"));
            c.up(
                generation,
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
        let id = c.down(generation, target(1)).unwrap().id;
        c.claim(id, "window-a", "account-a");
        assert!(c.cancel(id, "window-a", &scope("thread-a")));
        assert!(!c.consume(id, "window-a", &scope("thread-a")));
        assert!(c
            .start_capture(id, "window-a", &scope("thread-a"))
            .is_none());
        assert!(c
            .up(
                generation,
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
        let id = c.down(generation, target(1)).unwrap().id;
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
