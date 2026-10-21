//! Finding games in plain folders: listing directories, telling game exes from noise, scoring folders, and walking
//! whole folder trees incrementally.

pub mod cache;
pub mod classifier;
pub mod exes;
pub mod listing;
pub mod scanner;
pub mod suggest;
