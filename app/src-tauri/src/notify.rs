//! macOS notifications sent by DeviceTally itself. macOS hides an app's notifications while that app
//! is in front unless the app asks for them; this delegate always asks, so "Send a test" (clicked in
//! DeviceTally) shows too. Must run on the main thread.
//! NSUserNotification is deprecated in favour of UserNotifications, which only works for apps signed
//! with a paid Apple Developer ID; DeviceTally is ad-hoc signed, so this is the API that works.
#![allow(deprecated)]

use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, MainThreadOnly};
use objc2_foundation::{MainThreadMarker, NSString, NSUserNotification, NSUserNotificationCenter, NSUserNotificationCenterDelegate};

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "DeviceTallyNotificationDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl NSUserNotificationCenterDelegate for Delegate {
        #[unsafe(method(userNotificationCenter:shouldPresentNotification:))]
        fn should_present(&self, _c: &NSUserNotificationCenter, _n: &NSUserNotification) -> bool {
            true
        }
    }
);

thread_local! {
    // The center keeps only a weak reference to its delegate.
    static DELEGATE: std::cell::OnceCell<Retained<Delegate>> = const { std::cell::OnceCell::new() };
}

/// Shows a notification with an optional sound (a macOS sound name, or one in ~/Library/Sounds).
pub fn show(mtm: MainThreadMarker, title: &str, body: &str, sound: Option<&str>) {
    // Outside an .app bundle (e.g. a dev build) macOS has no notification center for us.
    if objc2_foundation::NSBundle::mainBundle().bundleIdentifier().is_none() {
        return;
    }
    let center = NSUserNotificationCenter::defaultUserNotificationCenter();
    DELEGATE.with(|d| {
        let d = d.get_or_init(|| unsafe { msg_send![Delegate::alloc(mtm), init] });
        unsafe { center.setDelegate(Some(ProtocolObject::from_ref(&**d))) };
    });
    let n = NSUserNotification::new();
    n.setTitle(Some(&NSString::from_str(title)));
    n.setInformativeText(Some(&NSString::from_str(body)));
    if let Some(s) = sound.filter(|s| !s.is_empty()) {
        n.setSoundName(Some(&NSString::from_str(s)));
    }
    center.deliverNotification(&n);
}
