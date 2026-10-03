// Manual check that macOS delivers DeviceTally's banners: cargo run --example notify_probe
fn main() {
    let _ = notify_rust::set_application("dev.devicetally.app");
    let r = notify_rust::Notification::new().summary("DeviceTally test").body("Claude Code finished · devicetally · took 3 min").sound_name("Glass").show();
    println!("{:?}", r.map(|_| "delivered"));
}
