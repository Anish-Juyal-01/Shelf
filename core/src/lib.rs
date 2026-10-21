//! Shelf's engine. Everything here only *reads* launcher data, the registry and game folders; it never changes,
//! moves or deletes anything in them.

pub mod model;
pub mod platform;
pub mod sources;
pub mod vdf;
