fn main() {
    println!("cargo:rerun-if-changed=native/desktop_notifications.cpp");
    println!("cargo:rerun-if-changed=native/system_fonts.cpp");
    println!("cargo:rerun-if-changed=native/appshots.cpp");
    println!("cargo:rerun-if-changed=native/appshots.h");
    println!("cargo:rerun-if-changed=native/appshots_entry_native.cpp");
    println!("cargo:rerun-if-changed=native/appshots_entry_native.h");
    println!("cargo:rerun-if-changed=../scripts/build-desktop-notifications.ps1");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let output = std::env::var("OUT_DIR").expect("Cargo OUT_DIR");
        let status = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "../scripts/build-desktop-notifications.ps1", "-OutDir", &output])
            .status().expect("Run Windows notification adapter compiler");
        assert!(status.success(), "Windows notification adapter compilation failed");
        println!("cargo:rustc-link-search=native={output}");
        println!("cargo:rustc-link-lib=static=desktop_notifications");
        println!("cargo:rustc-link-lib=static=system_fonts");
        println!("cargo:rustc-link-lib=static=appshots");
        println!("cargo:rustc-link-lib=static=appshots_entry_native");
        for library in ["windowsapp", "ole32", "propsys", "shell32", "uuid", "advapi32", "dwrite", "d3d11", "dxgi", "windowscodecs", "oleaut32", "user32", "wtsapi32"] {
            println!("cargo:rustc-link-lib=dylib={library}");
        }
    }
    tauri_build::build()
}
