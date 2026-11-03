use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

const MAX_INPUT: u64 = 10 * 1024 * 1024;
static PLAYER: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedAudio {
    name: String,
    data_base64: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAudio {
    file_name: String,
    name: String,
}

fn read_regular(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| format!("无法读取提示音：{e}"))?;
    if !meta.file_type().is_file() || meta.len() == 0 || meta.len() > limit {
        return Err("提示音必须为普通非空文件且大小不超过限制".into());
    }
    let file = std::fs::File::open(path).map_err(|e| format!("无法打开提示音：{e}"))?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("无法读取提示音：{e}"))?;
    if bytes.is_empty() || bytes.len() as u64 > limit {
        return Err("提示音文件大小无效".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn notification_audio_pick() -> Result<Option<PickedAudio>, String> {
    tokio::task::spawn_blocking(|| {
        let Some(path) = rfd::FileDialog::new()
            .set_title("选择自定义提示音")
            .add_filter("音频", &["mp3", "wav", "flac", "ogg", "oga"])
            .pick_file()
        else {
            return Ok(None);
        };
        let bytes = read_regular(&path, MAX_INPUT)?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("提示音文件名无效")?
            .to_string();
        Ok(Some(PickedAudio {
            name,
            data_base64: STANDARD.encode(bytes),
        }))
    })
    .await
    .map_err(|e| format!("无法选择提示音：{e}"))?
}

fn wav(samples: &[u8], channels: u16, rate: u32) -> Result<Vec<u8>, String> {
    if !(channels == 1 || channels == 2)
        || !(8000..=192000).contains(&rate)
        || samples.is_empty()
        || samples.len() % (channels as usize * 2) != 0
        || samples.len() as u64 >= rate as u64 * channels as u64 * 2 * 30
    {
        return Err("提示音必须为有效的单/双声道16位PCM，且时长小于30秒".into());
    }
    let size = samples.len() as u32;
    let mut bytes = Vec::with_capacity(samples.len() + 44);
    bytes.extend(b"RIFF");
    bytes.extend((36 + size).to_le_bytes());
    bytes.extend(b"WAVEfmt ");
    bytes.extend(16u32.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(channels.to_le_bytes());
    bytes.extend(rate.to_le_bytes());
    bytes.extend((rate * channels as u32 * 2).to_le_bytes());
    bytes.extend((channels * 2).to_le_bytes());
    bytes.extend(16u16.to_le_bytes());
    bytes.extend(b"data");
    bytes.extend(size.to_le_bytes());
    bytes.extend(samples);
    Ok(bytes)
}

// Dependency-free SHA-256 used for the content-addressed WAV name and readback.
fn sha256(input: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut hash: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut data = input.to_vec();
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend((input.len() as u64 * 8).to_be_bytes());
    for block in data.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, word) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes(word.try_into().unwrap());
        }
        for i in 16..64 {
            let x = w[i - 15];
            let y = w[i - 2];
            let s0 = x.rotate_right(7) ^ x.rotate_right(18) ^ (x >> 3);
            let s1 = y.rotate_right(17) ^ y.rotate_right(19) ^ (y >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = hash;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let t1 = h
                .wrapping_add(s1)
                .wrapping_add((e & f) ^ (!e & g))
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let t2 = s0.wrapping_add((a & b) ^ (a & c) ^ (b & c));
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (slot, value) in hash.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(value);
        }
    }
    hash.iter().map(|word| format!("{word:08x}")).collect()
}

fn custom_name(name: &str) -> bool {
    name.strip_prefix("codex-custom-")
        .and_then(|s| s.strip_suffix(".wav"))
        .is_some_and(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
}
fn storage(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("notification-sounds");
    std::fs::create_dir_all(&root).map_err(|e| format!("无法创建提示音目录：{e}"))?;
    if std::fs::symlink_metadata(&root)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("提示音目录不能为符号链接".into());
    }
    Ok(root)
}
fn persist(root: &Path, bytes: &[u8], name: String) -> Result<StoredAudio, String> {
    let file_name = format!("codex-custom-{}.wav", sha256(bytes));
    let destination = root.join(&file_name);
    if destination.exists() {
        if read_regular(&destination, 24 * 1024 * 1024)? != bytes {
            return Err("已有提示音副本内容不一致".into());
        }
    } else {
        let temporary = root.join(format!(".import-{}", uuid::Uuid::new_v4()));
        let result: Result<(), String> = (|| {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            file.write_all(bytes)
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string())?;
            std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
            if read_regular(&destination, 24 * 1024 * 1024)? != bytes {
                return Err("提示音保存后读取确认失败".into());
            }
            Ok(())
        })();
        let _ = std::fs::remove_file(&temporary);
        result?;
    }
    Ok(StoredAudio { file_name, name })
}
#[tauri::command]
pub async fn notification_audio_store(
    app: AppHandle,
    samples_base64: String,
    channels: u16,
    sample_rate: u32,
    name: String,
) -> Result<StoredAudio, String> {
    if samples_base64.len() > 32 * 1024 * 1024
        || name.is_empty()
        || name.len() > 1024
        || name.contains(['/', '\\', '\0'])
    {
        return Err("提示音数据或文件名无效".into());
    }
    tokio::task::spawn_blocking(move || {
        let samples = STANDARD
            .decode(samples_base64)
            .map_err(|_| "提示音样本编码无效")?;
        let bytes = wav(&samples, channels, sample_rate)?;
        persist(&storage(&app)?, &bytes, name)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn resolve_sound(app: &AppHandle, sound: &serde_json::Value) -> Result<Option<PathBuf>, String> {
    if sound.as_str() == Some("none") {
        return Ok(None);
    }
    if let Some(kind) = sound.as_str() {
        let (file, expected) = match kind {
            "default" => (
                "codex-notification.wav",
                "d3ec08b617dedc0d46de8da082e83fcd7526e129bbf6ce14354ee7f182a4e2ba",
            ),
            "classic" => (
                "codex-classic.wav",
                "c627dfe138e150d7340b608de3747c7538f90122cca6e6b22980a8c1b973125e",
            ),
            _ => return Err("此平台不支持该系统提示音，请重新选择".into()),
        };
        // Read-only local interoperability; these assets are never bundled or copied.
        let path = PathBuf::from("C:/Program Files/WindowsApps/OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0/app/resources").join(file);
        let bytes = read_regular(&path, MAX_INPUT)
            .map_err(|_| "未找到已核验的本机官方提示音；可导入自己的音频文件".to_string())?;
        if sha256(&bytes) != expected {
            return Err("本机官方提示音身份已变化，未播放".into());
        }
        return Ok(Some(path));
    }
    let name = sound
        .get("fileName")
        .and_then(|v| v.as_str())
        .filter(|s| custom_name(s))
        .ok_or("自定义提示音文件名无效")?;
    let path = storage(app)?.join(name);
    let bytes = read_regular(&path, 24 * 1024 * 1024)?;
    if format!("codex-custom-{}.wav", sha256(&bytes)) != name {
        return Err("自定义提示音内容校验失败".into());
    }
    Ok(Some(path))
}
#[cfg(windows)]
fn play(path: Option<&Path>) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "winmm")]
    extern "system" {
        fn PlaySoundW(sound: *const u16, module: *mut std::ffi::c_void, flags: u32) -> i32;
    }
    let wide = path.map(|p| {
        p.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    });
    let ok = unsafe {
        PlaySoundW(
            wide.as_ref().map_or(std::ptr::null(), |s| s.as_ptr()),
            std::ptr::null_mut(),
            if path.is_some() {
                0x00020000 | 0x0001 | 0x0002
            } else {
                0
            },
        )
    };
    if ok == 0 {
        Err("系统无法播放提示音".into())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn play(path: Option<&Path>) -> Result<(), String> {
    if path.is_none() {
        Ok(())
    } else {
        Err("当前平台尚未接入真实提示音播放".into())
    }
}
#[tauri::command]
pub fn notification_audio_play(app: AppHandle, sound: serde_json::Value) -> Result<(), String> {
    let _guard = PLAYER.lock().map_err(|_| "提示音播放器不可用")?;
    play(None)?;
    let path = resolve_sound(&app, &sound)?;
    if let Some(path) = path {
        play(Some(&path))?;
    }
    Ok(())
}
#[tauri::command]
pub fn notification_audio_stop() -> Result<(), String> {
    let _guard = PLAYER.lock().map_err(|_| "提示音播放器不可用")?;
    play(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn audio_sha256_known_vectors_and_name_boundary() {
        assert_eq!(
            sha256(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256(&vec![b'a'; 1_000_000]),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
        assert!(!custom_name("../codex-custom-a.wav"));
        assert!(custom_name(&format!("codex-custom-{}.wav", "a".repeat(64))));
    }
    #[test]
    fn audio_pcm_riff_strict_duration_channels_and_alignment() {
        let bytes = wav(&[0, 128, 255, 127], 2, 48000).unwrap();
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..16], b"WAVEfmt ");
        assert_eq!(&bytes[40..44], &4u32.to_le_bytes());
        assert_eq!(&bytes[44..], &[0, 128, 255, 127]);
        for channels in [0, 3, 7] {
            assert!(wav(&[0, 0], channels, 48000).is_err());
        }
        assert!(wav(&[], 1, 48000).is_err());
        assert!(wav(&[0], 1, 48000).is_err());
        assert!(wav(&vec![0; 8000 * 2 * 30], 1, 8000).is_err());
        assert!(wav(&vec![0; 8000 * 2 * 30 - 2], 1, 8000).is_ok());
    }
    #[test]
    fn audio_persist_readback_source_independence_and_tamper_rejection() {
        let root = std::env::temp_dir().join(format!("codex-audio-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let bytes = wav(&[0, 0, 1, 0], 1, 8000).unwrap();
        let stored = persist(&root, &bytes, "中文 '提示音'.mp3".into()).unwrap();
        assert_eq!(
            read_regular(&root.join(&stored.file_name), MAX_INPUT).unwrap(),
            bytes
        );
        persist(&root, &bytes, "another.wav".into()).unwrap();
        std::fs::write(root.join(&stored.file_name), b"tampered").unwrap();
        assert!(persist(&root, &bytes, "again.wav".into()).is_err());
        std::fs::remove_file(root.join(stored.file_name)).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
