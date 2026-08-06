use yd_lib::tts::{map_rate, map_rate_wpm, TtsEngine};

#[test]
fn rate_clamping() {
    let engine = TtsEngine::new();
    engine.set_rate(5.0);
    assert_eq!(engine.rate(), 2.0);
    engine.set_rate(0.1);
    assert_eq!(engine.rate(), 0.5);
    engine.set_rate(1.5);
    assert_eq!(engine.rate(), 1.5);
}

#[test]
fn rate_mapping() {
    assert_eq!(map_rate(0.5), -10);
    assert_eq!(map_rate(1.0), 0);
    assert_eq!(map_rate(1.5), 10);
    assert_eq!(map_rate(2.0), 10);
    assert_eq!(map_rate_wpm(0.5), 88);
    assert_eq!(map_rate_wpm(1.0), 175);
    assert_eq!(map_rate_wpm(2.0), 350);
}
