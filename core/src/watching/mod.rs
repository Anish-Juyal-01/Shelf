//! Playtime and new games while Shelf runs: which games are running (process snapshots), sessions from that,
//! unknown programs that look like games (foreground window, GPU use), and new downloads in the scan folders.
//! Shelf only looks: it never reads a game's memory, injects or hooks anything.

pub mod detector;
pub mod folders;
pub mod index;
#[cfg(windows)]
pub mod system;
pub mod tracker;
pub mod watcher;

use std::sync::atomic::{AtomicI64, Ordering};

/// The time, in unix ms. Behind a trait so the watcher can be driven by a fake clock in tests.
pub trait Clock: Send + Sync {
    fn now(&self) -> i64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> i64 {
        crate::platform::now_ms()
    }
}

/// A clock that only moves when told to.
#[derive(Debug, Default)]
pub struct FakeClock(AtomicI64);

impl FakeClock {
    pub fn at(ms: i64) -> Self {
        Self(AtomicI64::new(ms))
    }

    pub fn advance(&self, ms: i64) {
        self.0.fetch_add(ms, Ordering::Relaxed);
    }
}

impl Clock for FakeClock {
    fn now(&self) -> i64 {
        self.0.load(Ordering::Relaxed)
    }
}

/// A running process: pid, exe name, and full exe path when Windows would tell us.
#[derive(Debug, Clone, PartialEq)]
pub struct ProcInfo {
    pub pid: u32,
    pub name: String,
    pub path: Option<String>,
}

pub trait ProcessSource: Send {
    fn snapshot(&mut self) -> Vec<ProcInfo>;
}

/// The foreground window's process and whether it covers its whole monitor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ForegroundWindow {
    pub pid: u32,
    pub fullscreen: bool,
}

pub trait ForegroundProbe: Send {
    fn current(&self) -> Option<ForegroundWindow>;
}

pub trait GpuSampler: Send {
    /// 3D-engine use (0–100) of one process since the previous call for that pid; `None` when unknown.
    fn sample(&mut self, pid: u32) -> Option<f64>;
    /// False when Windows doesn't expose GPU counters (old drivers, some VMs).
    fn available(&self) -> bool;
}
