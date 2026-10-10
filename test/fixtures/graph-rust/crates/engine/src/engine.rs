use crate::run;
use std::collections::HashMap;

pub struct Engine {
    map: HashMap<String, String>,
}

impl Engine {
    pub fn new() -> Self { Engine { map: HashMap::new() } }
}

pub enum Mode { Fast }
pub trait Runner {}
