use yd_lib::tts::TtsEngine;

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
