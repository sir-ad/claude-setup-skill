mod cli;

use engine_core::{Engine, run};
use serde::Serialize;

fn main() {
    cli::parse();
    let _ = (Engine::new(), run());
}
