#[cfg(target_os = "windows")]
mod windows_impl {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{
        ffi::OsStr,
        mem::{self, MaybeUninit},
        os::windows::ffi::OsStrExt,
        path::Path,
    };
    use windows::{
        core::PCWSTR,
        Win32::{
            Graphics::Gdi::{
                DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
                BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
            },
            Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES,
            UI::{
                Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON},
                WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON},
            },
        },
    };

    struct OwnedIcon(HICON);
    impl Drop for OwnedIcon {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                let _ = unsafe { DestroyIcon(self.0) };
            }
        }
    }

    struct OwnedBitmap(HBITMAP);
    impl Drop for OwnedBitmap {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                let _ = unsafe { DeleteObject(HGDIOBJ::from(self.0)) };
            }
        }
    }

    struct OwnedDc(HDC);
    impl Drop for OwnedDc {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                let _ = unsafe { ReleaseDC(None, self.0) };
            }
        }
    }

    pub fn extract(path: &str) -> Result<Option<String>, String> {
        let path = Path::new(path);
        if !path.is_file() {
            return Ok(None);
        }

        let wide_path: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();
        let mut file_info = MaybeUninit::<SHFILEINFOW>::uninit();
        let result = unsafe {
            SHGetFileInfoW(
                PCWSTR::from_raw(wide_path.as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(0),
                Some(file_info.as_mut_ptr()),
                mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON,
            )
        };
        if result == 0 {
            return Ok(None);
        }

        let icon = OwnedIcon(unsafe { file_info.assume_init() }.hIcon);
        if icon.0 .0.is_null() {
            return Ok(None);
        }
        let (width, height, rgba) = hicon_to_rgba(icon.0)?;
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
            writer
                .write_image_data(&rgba)
                .map_err(|error| error.to_string())?;
        }
        Ok(Some(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(png_bytes)
        )))
    }

    fn hicon_to_rgba(icon: HICON) -> Result<(u32, u32, Vec<u8>), String> {
        let mut icon_info = MaybeUninit::uninit();
        unsafe { GetIconInfo(icon, icon_info.as_mut_ptr()) }.map_err(|error| error.to_string())?;
        let icon_info = unsafe { icon_info.assume_init() };
        let _mask = OwnedBitmap(icon_info.hbmMask);
        let color = OwnedBitmap(icon_info.hbmColor);
        if color.0 .0.is_null() {
            return Err("图标没有可读取的彩色位图".into());
        }

        let mut bitmap = MaybeUninit::<BITMAP>::uninit();
        let object_size =
            i32::try_from(mem::size_of::<BITMAP>()).map_err(|error| error.to_string())?;
        let copied = unsafe {
            GetObjectW(
                HGDIOBJ::from(color.0),
                object_size,
                Some(bitmap.as_mut_ptr().cast()),
            )
        };
        if copied != object_size {
            return Err("无法读取图标位图".into());
        }
        let bitmap = unsafe { bitmap.assume_init() };
        let width = bitmap.bmWidth.unsigned_abs();
        let height = bitmap.bmHeight.unsigned_abs();
        if width == 0 || height == 0 || width > 512 || height > 512 {
            return Err("图标尺寸无效".into());
        }

        let pixel_count = usize::try_from(width)
            .ok()
            .and_then(|value| value.checked_mul(height as usize))
            .ok_or("图标尺寸溢出")?;
        let mut bgra = vec![0u32; pixel_count];
        let dc = OwnedDc(unsafe { GetDC(None) });
        if dc.0 .0.is_null() {
            return Err("无法创建图标绘制上下文".into());
        }
        let mut bitmap_info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: bitmap.bmWidth,
                biHeight: -bitmap.bmHeight,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            bmiColors: [Default::default()],
        };
        let lines = unsafe {
            GetDIBits(
                dc.0,
                color.0,
                0,
                height,
                Some(bgra.as_mut_ptr().cast()),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            )
        };
        if lines != height as i32 {
            return Err("无法复制图标像素".into());
        }

        let bytes = unsafe {
            std::slice::from_raw_parts(
                bgra.as_ptr().cast::<u8>(),
                bgra.len() * mem::size_of::<u32>(),
            )
        };
        let mut rgba: Vec<u8> = bytes
            .chunks_exact(4)
            .flat_map(|pixel| [pixel[2], pixel[1], pixel[0], pixel[3]])
            .collect();
        if rgba.chunks_exact(4).all(|pixel| pixel[3] == 0) {
            // 一些 Electron 程序的图标颜色位图没有写入 alpha，透明区域只保存在
            // Windows 的 AND 蒙版中。此时用蒙版恢复透明度，避免把可用图标误判为空。
            restore_alpha_from_mask(icon_info.hbmMask, width, height, &mut rgba)?;
        }
        Ok((width, height, rgba))
    }

    fn restore_alpha_from_mask(
        mask: HBITMAP,
        width: u32,
        height: u32,
        rgba: &mut [u8],
    ) -> Result<(), String> {
        if mask.0.is_null() {
            return Err("图标透明通道为空，且没有可读取的透明蒙版".into());
        }
        let pixel_count = usize::try_from(width)
            .ok()
            .and_then(|value| value.checked_mul(height as usize))
            .ok_or("图标蒙版尺寸溢出")?;
        let mut mask_pixels = vec![0u32; pixel_count];
        let dc = OwnedDc(unsafe { GetDC(None) });
        if dc.0 .0.is_null() {
            return Err("无法创建图标蒙版绘制上下文".into());
        }
        let mut bitmap_info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            bmiColors: [Default::default()],
        };
        let lines = unsafe {
            GetDIBits(
                dc.0,
                mask,
                0,
                height,
                Some(mask_pixels.as_mut_ptr().cast()),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            )
        };
        if lines != height as i32 {
            return Err("无法读取图标透明蒙版".into());
        }

        let mask_bytes = unsafe {
            std::slice::from_raw_parts(
                mask_pixels.as_ptr().cast::<u8>(),
                mask_pixels.len() * mem::size_of::<u32>(),
            )
        };
        for (pixel, mask_pixel) in rgba.chunks_exact_mut(4).zip(mask_bytes.chunks_exact(4)) {
            // AND 蒙版中黑色代表不透明，白色代表透明。
            pixel[3] = if mask_pixel[0..3].iter().any(|channel| *channel != 0) {
                0
            } else {
                255
            };
        }
        if rgba.chunks_exact(4).all(|pixel| pixel[3] == 0) {
            return Err("图标颜色位图和透明蒙版均为空".into());
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::extract;

        #[test]
        fn extracts_current_executable_as_png_data_url() {
            let path = std::env::current_exe().expect("current executable path");
            let icon = extract(&path.to_string_lossy())
                .expect("icon extraction")
                .expect("associated icon");
            assert!(icon.starts_with("data:image/png;base64,"));
            assert!(icon.len() > 100);
        }

        #[test]
        fn extracts_icons_requested_for_diagnostics() {
            let Ok(paths) = std::env::var("APP_PROXY_ICON_TEST_PATHS") else {
                return;
            };
            for path in paths.split(';').filter(|path| !path.is_empty()) {
                let icon = extract(path)
                    .unwrap_or_else(|error| panic!("无法提取 {path} 的图标：{error}"))
                    .unwrap_or_else(|| panic!("{path} 没有可提取的图标"));
                assert!(icon.starts_with("data:image/png;base64,"));
                assert!(icon.len() > 100, "{path} 的图标数据异常");
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub fn extract_icon_data_url(path: &str) -> Result<Option<String>, String> {
    windows_impl::extract(path)
}

#[cfg(not(target_os = "windows"))]
pub fn extract_icon_data_url(_path: &str) -> Result<Option<String>, String> {
    Ok(None)
}

pub fn write_png_as_ico(
    source: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
    let source_file =
        std::fs::File::open(source).map_err(|error| format!("无法读取应用图标：{error}"))?;
    let image = ico::IconImage::read_png(source_file)
        .map_err(|error| format!("无法解析应用清单图标：{error}"))?;
    if image.width() == 0 || image.height() == 0 || image.width() > 256 || image.height() > 256 {
        return Err("快捷方式图标尺寸必须在 1 到 256 像素之间".into());
    }
    let entry = ico::IconDirEntry::encode_as_png(&image)
        .map_err(|error| format!("无法编码快捷方式图标：{error}"))?;
    let mut icon = ico::IconDir::new(ico::ResourceType::Icon);
    icon.add_entry(entry);
    let destination_file = std::fs::File::create(destination)
        .map_err(|error| format!("无法保存快捷方式图标：{error}"))?;
    icon.write(destination_file)
        .map_err(|error| format!("无法保存快捷方式图标：{error}"))
}

#[cfg(test)]
mod icon_file_tests {
    use super::write_png_as_ico;

    #[test]
    fn generated_icon_decodes_with_standard_icon_reader() {
        let directory =
            std::env::temp_dir().join(format!("app-proxy-ico-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("icons/128x128.png");
        let destination = directory.join("Application.ico");

        write_png_as_ico(&source, &destination).unwrap();
        let icon = ico::IconDir::read(std::fs::File::open(&destination).unwrap()).unwrap();
        assert_eq!(icon.entries().len(), 1);
        assert_eq!(icon.entries()[0].width(), 128);
        assert_eq!(icon.entries()[0].height(), 128);
        assert_eq!(
            icon.entries()[0].decode().unwrap().rgba_data().len(),
            128 * 128 * 4
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
