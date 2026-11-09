use anyhow::{Result, ensure};
// Linux x86_64 seccomp: deny external sockets and io_uring.
// Tokio uses private Unix socketpairs for its internal signal notifications.
// No inherited network descriptors are passed by the GNOME subprocess launcher.
pub fn deny_network() -> Result<()> {
    #[cfg(not(all(target_os = "linux", target_arch = "x86_64")))]
    anyhow::bail!("Offline enforcement currently supports Linux x86_64 only");
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    unsafe {
        let stmt = |code, k| libc::sock_filter {
            code,
            jt: 0,
            jf: 0,
            k,
        };
        let jump = |k, jt, jf| libc::sock_filter {
            code: 0x15,
            jt,
            jf,
            k,
        };
        let mut filter = vec![
            stmt(0x20, 4),
            jump(0xc000003e, 1, 0),
            stmt(0x06, 0x80000000),
            stmt(0x20, 0),
            // Reject x32 syscall ABI as well.
            libc::sock_filter {
                code: 0x45,
                jt: 0,
                jf: 1,
                k: 0x40000000,
            },
            stmt(0x06, 0x00050001),
        ];
        // Allow only already-connected, unnamed Unix socketpairs. No addresses or peers.
        filter.extend([
            jump(libc::SYS_socketpair as u32, 0, 4),
            stmt(0x20, 16), // args[0]: address family
            jump(libc::AF_UNIX as u32, 0, 1),
            stmt(0x06, 0x7fff0000),
            stmt(0x06, 0x00050001),
        ]);
        for call in [libc::SYS_socket, libc::SYS_connect, libc::SYS_bind,
            libc::SYS_listen, libc::SYS_accept, libc::SYS_accept4, libc::SYS_io_uring_setup] {
            filter.extend([jump(call as u32, 0, 1), stmt(0x06, 0x00050001)]);
        }
        filter.push(stmt(0x06, 0x7fff0000));
        let program = libc::sock_fprog {
            len: filter.len() as u16,
            filter: filter.as_mut_ptr(),
        };
        ensure!(
            libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == 0,
            "Cannot enforce no-new-privileges"
        );
        ensure!(
            libc::prctl(libc::PR_SET_SECCOMP, 2, &program) == 0,
            "Cannot enforce offline mode"
        );
    }
    Ok(())
}
pub fn check() -> Result<()> {
    for family in [libc::AF_INET, libc::AF_INET6, libc::AF_UNIX] {
        let fd = unsafe { libc::socket(family, libc::SOCK_STREAM, 0) };
        if fd >= 0 {
            unsafe {
                libc::close(fd);
            }
        }
        ensure!(
            fd == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM),
            "Socket isolation failed"
        );
    }
    let mut pair = [-1; 2];
    let result = unsafe { libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, pair.as_mut_ptr()) };
    ensure!(result == 0, "Internal runtime socketpair unavailable");
    unsafe { libc::close(pair[0]); libc::close(pair[1]); }
    let result = unsafe { libc::socketpair(libc::AF_INET, libc::SOCK_STREAM, 0, pair.as_mut_ptr()) };
    ensure!(result == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM),
        "Internet socketpair was not blocked");
    let result = unsafe { libc::connect(-1, std::ptr::null(), 0) };
    ensure!(result == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM),
        "External connections were not blocked");
    Ok(())
}
