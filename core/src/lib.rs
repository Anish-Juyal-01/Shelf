//! Shelf's engine. Everything here only *reads* launcher data, the registry and game folders; it never changes,
//! moves or deletes anything in them. Shelf's own files (settings, database, caches) live in `storage`.

pub mod art;
pub mod launching;
pub mod library;
pub mod matcher;
pub mod metadata;
pub mod model;
pub mod naming;
pub mod platform;
pub mod scanning;
pub mod sources;
pub mod storage;
pub mod vdf;
pub mod watching;
