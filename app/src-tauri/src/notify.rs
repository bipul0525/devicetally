//! macOS notifications through Apple's UserNotifications. macOS only allows them for apps signed
//! with a paid Developer ID; DeviceTally is ad-hoc signed, so `send` reports the refusal and the app
//! shows its own notification card instead (see show_card in lib.rs).

use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, MainThreadOnly};
use objc2_foundation::{MainThreadMarker, NSString};

// ---- Apple's current notification system (UserNotifications) ----
// It asks permission once and reports what happened, so "Send a test" can say whether macOS
// accepted the notification, or why not. If it refuses this app (e.g. its signature), the older
// sender above is used instead.

use objc2::runtime::Bool;
use objc2_foundation::NSError;
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationSound, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "DeviceTallyUNDelegate"]
    struct UnDelegate;

    unsafe impl NSObjectProtocol for UnDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for UnDelegate {
        // Show banners even while DeviceTally is the front app (e.g. "Send a test").
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(&self, _c: &UNUserNotificationCenter, _n: &UNNotification, done: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>) {
            done.call((UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List | UNNotificationPresentationOptions::Sound,));
        }
    }
);

thread_local! {
    static UN_DELEGATE: std::cell::OnceCell<Retained<UnDelegate>> = const { std::cell::OnceCell::new() };
}

fn bundled() -> bool {
    objc2_foundation::NSBundle::mainBundle().bundleIdentifier().is_some()
}

/// Sets the delegate (main thread, once at start).
pub fn setup(mtm: MainThreadMarker) {
    if !bundled() {
        return;
    }
    UN_DELEGATE.with(|d| {
        let d = d.get_or_init(|| unsafe { msg_send![UnDelegate::alloc(mtm), init] });
        UNUserNotificationCenter::currentNotificationCenter().setDelegate(Some(ProtocolObject::from_ref(&**d)));
    });
}

fn err_text(e: *mut NSError) -> Option<String> {
    // SAFETY: a valid NSError or null, passed by UserNotifications.
    unsafe { e.as_ref() }.map(|e| e.localizedDescription().to_string())
}

/// Sends a notification and calls `done` with what macOS said (any thread).
pub fn send(title: &str, body: &str, sound: Option<&str>, done: impl Fn(Result<(), String>) + Send + Sync + 'static) {
    if !bundled() {
        return done(Err("not running as an app bundle".into()));
    }
    let (title, body, sound) = (title.to_string(), body.to_string(), sound.map(String::from));
    let done = std::sync::Arc::new(done);
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let after_auth = block2::RcBlock::new(move |granted: Bool, e: *mut NSError| {
        if !granted.as_bool() {
            return done(Err(err_text(e).unwrap_or_else(|| "denied".into())));
        }
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&title));
        content.setBody(&NSString::from_str(&body));
        if let Some(s) = sound.as_deref().filter(|s| !s.is_empty()) {
            content.setSound(Some(&UNNotificationSound::soundNamed(&NSString::from_str(s))));
        }
        let id = NSString::from_str(&format!("dt-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
        let req = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
        let done2 = done.clone();
        let added = block2::RcBlock::new(move |e: *mut NSError| done2(err_text(e).map_or(Ok(()), Err)));
        UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&req, Some(&added));
    });
    center.requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound, &after_auth);
}
