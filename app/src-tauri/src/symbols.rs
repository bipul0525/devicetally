//! Drawing with macOS itself, like system menu-bar items: SF Symbols (the icons macOS's own menu bar
//! uses) and text in the system fonts with real weights and Apple's antialiasing. Both become alpha
//! masks for the menu-bar image, cached.

use std::collections::HashMap;
use std::sync::Mutex;

/// Coverage mask: `w * h` alpha values.
#[derive(Clone)]
pub struct Mask {
    pub w: usize,
    pub h: usize,
    pub alpha: Vec<u8>,
}

/// The symbol `name` scaled to `h` px high (width follows its shape), in the given weight
/// ("regular" | "medium" | "bold"). None if this macOS doesn't have it.
pub fn symbol(name: &str, h: usize, weight: &str) -> Option<Mask> {
    static CACHE: Mutex<Option<HashMap<(String, usize, String), Option<Mask>>>> = Mutex::new(None);
    let key = (name.to_string(), h, weight.to_string());
    if let Some(m) = CACHE.lock().unwrap().get_or_insert_with(HashMap::new).get(&key) {
        return m.clone();
    }
    let m = draw(name, h, weight);
    CACHE.lock().unwrap().as_mut().unwrap().insert(key, m.clone());
    m
}

fn draw(name: &str, h: usize, weight: &str) -> Option<Mask> {
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSBitmapImageRep, NSDeviceRGBColorSpace, NSFontWeightMedium, NSFontWeightRegular, NSFontWeightSemibold, NSGraphicsContext, NSImage, NSImageSymbolConfiguration};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
    if h == 0 {
        return None;
    }
    // SAFETY: plain AppKit drawing into our own offscreen bitmap; nothing is shared with the UI.
    unsafe {
        let weight = match weight { "bold" => NSFontWeightSemibold, "medium" => NSFontWeightMedium, _ => NSFontWeightRegular };
        let img = NSImage::imageWithSystemSymbolName_accessibilityDescription(&NSString::from_str(name), None)?;
        let cfg = NSImageSymbolConfiguration::configurationWithPointSize_weight(h as f64, weight);
        let img = img.imageWithSymbolConfiguration(&cfg)?;
        let size = img.size();
        if size.height <= 0.0 {
            return None;
        }
        let w = ((size.width / size.height) * h as f64).ceil().max(1.0) as usize;
        let rep = NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(), std::ptr::null_mut(), w as isize, h as isize, 8, 4, true, false, NSDeviceRGBColorSpace, (w * 4) as isize, 32,
        )?;
        let ctx = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&ctx));
        img.drawInRect(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(w as f64, h as f64)));
        ctx.flushGraphics();
        NSGraphicsContext::restoreGraphicsState_class();
        let data = rep.bitmapData();
        if data.is_null() {
            return None;
        }
        let px = std::slice::from_raw_parts(data, w * h * 4);
        Some(Mask { w, h, alpha: px.chunks(4).map(|p| p[3]).collect() })
    }
}

/// A line of text: its mask, where the baseline is (px from the top), and its advance width.
#[derive(Clone)]
pub struct Text {
    pub mask: Mask,
    pub baseline: f32,
    pub width: f32,
}

/// The NSFont for a font key (FONTS in menubar.rs) at `px`, in the given weight.
unsafe fn ns_font(key: &str, px: f64, weight: &str) -> Option<objc2::rc::Retained<objc2_app_kit::NSFont>> {
    use objc2_app_kit::{NSFont, NSFontDescriptorSystemDesignMonospaced, NSFontDescriptorSystemDesignRounded, NSFontDescriptorSystemDesignSerif, NSFontWeightBold, NSFontWeightMedium, NSFontWeightRegular, NSFontWeightSemibold};
    use objc2_foundation::NSString;
    let (w, bold) = match weight { "bold" => (NSFontWeightBold, true), "semibold" => (NSFontWeightSemibold, true), "medium" => (NSFontWeightMedium, false), _ => (NSFontWeightRegular, false) };
    // System font with steady-width digits, so numbers don't jiggle (what Stats and macOS use).
    let system = || NSFont::monospacedDigitSystemFontOfSize_weight(px, w);
    let design = |d: &objc2_app_kit::NSFontDescriptorSystemDesign| system().fontDescriptor().fontDescriptorWithDesign(d).and_then(|fd| NSFont::fontWithDescriptor_size(&fd, px));
    let named = |regular: &str, medium: &str, heavy: &str| NSFont::fontWithName_size(&NSString::from_str(if bold { heavy } else if weight == "medium" { medium } else { regular }), px);
    let f = match key {
        "rounded" => design(NSFontDescriptorSystemDesignRounded),
        "mono" => Some(NSFont::monospacedSystemFontOfSize_weight(px, w)),
        "newyork" => design(NSFontDescriptorSystemDesignSerif),
        "sfmono" => design(NSFontDescriptorSystemDesignMonospaced),
        "helvetica" => named("HelveticaNeue", "HelveticaNeue-Medium", "HelveticaNeue-Bold"),
        "menlo" => named("Menlo-Regular", "Menlo-Regular", "Menlo-Bold"),
        "monaco" => named("Monaco", "Monaco", "Monaco"),
        "din" => named("DINAlternate-Bold", "DINAlternate-Bold", "DINAlternate-Bold"),
        "futura" => named("Futura-Medium", "Futura-Medium", "Futura-Bold"),
        "avenir" => named("Avenir-Book", "Avenir-Medium", "Avenir-Heavy"),
        "georgia" => named("Georgia", "Georgia", "Georgia-Bold"),
        "verdana" => named("Verdana", "Verdana", "Verdana-Bold"),
        _ => None,
    };
    Some(f.unwrap_or_else(system))
}

/// Ascent and descent (positive, px) of a font, for placing lines.
pub fn metrics(key: &str, px: f32, weight: &str) -> (f32, f32) {
    unsafe { ns_font(key, px as f64, weight).map(|f| (f.ascender() as f32, -f.descender() as f32)).unwrap_or((px * 0.8, px * 0.2)) }
}

/// `s` drawn by macOS at `px` (black; only the alpha is kept). Cached; the cache is cleared when it
/// grows past a few thousand entries (numbers change, labels don't).
pub fn text(s: &str, px: f32, key: &str, weight: &str) -> Option<Text> {
    type Key = (String, u32, String, String);
    static CACHE: Mutex<Option<HashMap<Key, Option<Text>>>> = Mutex::new(None);
    let k = (s.to_string(), (px * 100.0) as u32, key.to_string(), weight.to_string());
    {
        let mut c = CACHE.lock().unwrap();
        let c = c.get_or_insert_with(HashMap::new);
        if let Some(t) = c.get(&k) {
            return t.clone();
        }
        if c.len() > 4000 {
            c.clear();
        }
    }
    let t = draw_text(s, px, key, weight);
    CACHE.lock().unwrap().as_mut().unwrap().insert(k, t.clone());
    t
}

fn draw_text(s: &str, px: f32, key: &str, weight: &str) -> Option<Text> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSBitmapImageRep, NSColor, NSDeviceRGBColorSpace, NSFontAttributeName, NSForegroundColorAttributeName, NSGraphicsContext, NSStringDrawing};
    use objc2_foundation::{NSDictionary, NSPoint, NSString};
    if s.is_empty() {
        return Some(Text { mask: Mask { w: 0, h: 0, alpha: vec![] }, baseline: 0.0, width: 0.0 });
    }
    unsafe {
        let font = ns_font(key, px as f64, weight)?;
        let (asc, desc) = (font.ascender(), -font.descender());
        let font_obj: Retained<AnyObject> = Retained::cast_unchecked(font);
        let color: Retained<AnyObject> = Retained::cast_unchecked(NSColor::blackColor());
        let attrs = NSDictionary::from_retained_objects(&[NSFontAttributeName, NSForegroundColorAttributeName], &[font_obj, color]);
        let ns = NSString::from_str(s);
        let size = ns.sizeWithAttributes(Some(&attrs));
        let (w, h) = ((size.width.ceil() as usize + 2).max(1), ((asc + desc).ceil() as usize + 2).max(1));
        let rep = NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(), std::ptr::null_mut(), w as isize, h as isize, 8, 4, true, false, NSDeviceRGBColorSpace, (w * 4) as isize, 32,
        )?;
        let ctx = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&ctx));
        // Bottom-left origin: the text's line box starts 1 px up, so the baseline sits at desc + 1.
        ns.drawAtPoint_withAttributes(NSPoint::new(0.0, 1.0), Some(&attrs));
        ctx.flushGraphics();
        NSGraphicsContext::restoreGraphicsState_class();
        let data = rep.bitmapData();
        if data.is_null() {
            return None;
        }
        let px_ = std::slice::from_raw_parts(data, w * h * 4);
        Some(Text { mask: Mask { w, h, alpha: px_.chunks(4).map(|p| p[3]).collect() }, baseline: h as f32 - 1.0 - desc as f32, width: size.width as f32 })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn draws_text_with_the_system_fonts() {
        let t = super::text("151M", 20.0, "system", "regular").expect("text");
        assert!(t.width > 20.0 && t.mask.alpha.iter().any(|&a| a > 200));
        assert!(t.baseline > 10.0 && t.baseline < t.mask.h as f32);
        let bold = super::text("151M", 20.0, "system", "bold").unwrap();
        assert!(bold.width >= t.width, "bold is at least as wide");
        // Steady-width digits: 1 and 8 take the same room.
        assert_eq!(super::text("111", 20.0, "system", "regular").unwrap().width, super::text("888", 20.0, "system", "regular").unwrap().width);
        for f in ["rounded", "mono", "newyork", "helvetica", "menlo", "monaco", "din", "futura", "avenir", "georgia", "verdana"] {
            assert!(super::text("42%", 20.0, f, "medium").is_some(), "{f}");
        }
    }

    #[test]
    fn draws_system_symbols() {
        let m = super::symbol("battery.75percent", 26, "regular").expect("battery symbol");
        assert_eq!(m.h, 26);
        assert!(m.w > 26, "a battery is wider than tall");
        assert!(m.alpha.iter().any(|&a| a > 200), "something was drawn");
        assert!(super::symbol("no.such.symbol.devicetally", 26, "regular").is_none());
    }
}
