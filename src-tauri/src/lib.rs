use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use tauri::utils::config::Color;
use tauri::{
    window::{Effect, EffectState, EffectsBuilder},
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

#[derive(Debug, Serialize)]
struct WorklogFile {
    date: String,
    content: String,
    exists: bool,
}

#[cfg(not(debug_assertions))]
const DISABLE_WEBVIEW_CONTEXT_MENU_SCRIPT: &str = r#"
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
}, { capture: true });
"#;

#[cfg(debug_assertions)]
fn with_release_context_menu_disabled<'a, R: tauri::Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
}

#[cfg(not(debug_assertions))]
fn with_release_context_menu_disabled<'a, R: tauri::Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder.initialization_script(DISABLE_WEBVIEW_CONTEXT_MENU_SCRIPT)
}

#[tauri::command]
fn list_entries(app: AppHandle) -> Result<Vec<WorklogFile>, String> {
    let root = resolve_worklog_root(&app)?;
    let daily_dir = root.join("daily");

    if !daily_dir.exists() {
        fs::create_dir_all(&daily_dir).map_err(|error| error.to_string())?;
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for item in fs::read_dir(&daily_dir).map_err(|error| error.to_string())? {
        let item = item.map_err(|error| error.to_string())?;
        let date = item.file_name().to_string_lossy().to_string();

        if validate_iso_date(&date).is_err() {
            continue;
        }

        let file_path = entry_path(&root, &date)?;
        if file_path.exists() {
            let content = fs::read_to_string(&file_path).map_err(|error| error.to_string())?;
            entries.push(WorklogFile {
                date,
                content,
                exists: true,
            });
        }
    }

    entries.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(entries)
}

#[tauri::command]
fn read_entry(app: AppHandle, date: String) -> Result<WorklogFile, String> {
    let root = resolve_worklog_root(&app)?;
    let file_path = entry_path(&root, &date)?;

    if file_path.exists() {
        Ok(WorklogFile {
            date,
            content: fs::read_to_string(&file_path).map_err(|error| error.to_string())?,
            exists: true,
        })
    } else {
        Ok(WorklogFile {
            content: daily_template(&date),
            date,
            exists: false,
        })
    }
}

#[tauri::command]
fn create_entry(app: AppHandle, date: String) -> Result<WorklogFile, String> {
    let root = resolve_worklog_root(&app)?;
    let file_path = entry_path(&root, &date)?;

    if file_path.exists() {
        return read_entry(app, date);
    }

    let content = daily_template(&date);
    fs::create_dir_all(file_path.parent().ok_or("无法解析日记目录")?)
        .map_err(|error| error.to_string())?;
    fs::write(&file_path, &content).map_err(|error| error.to_string())?;

    Ok(WorklogFile {
        date,
        content,
        exists: true,
    })
}

#[tauri::command]
fn save_entry(app: AppHandle, date: String, content: String) -> Result<WorklogFile, String> {
    let root = resolve_worklog_root(&app)?;
    let file_path = entry_path(&root, &date)?;

    fs::create_dir_all(file_path.parent().ok_or("无法解析日记目录")?)
        .map_err(|error| error.to_string())?;
    fs::write(&file_path, &content).map_err(|error| error.to_string())?;

    Ok(WorklogFile {
        date,
        content,
        exists: true,
    })
}

#[tauri::command]
fn open_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        if window.is_visible().map_err(|error| error.to_string())? {
            window.set_focus().map_err(|error| error.to_string())?;
        } else {
            show_settings_window(&window)?;
        }
        return Ok(());
    }

    let mut builder =
        WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings".into()))
            .title("设置")
            .inner_size(680.0, 560.0)
            .min_inner_size(600.0, 500.0)
            .resizable(true)
            .decorations(true)
            .transparent(true)
            .background_color(Color(0, 0, 0, 0))
            .visible(false);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .hidden_title(true)
            .title_bar_style(TitleBarStyle::Overlay);
    }

    let builder = with_release_context_menu_disabled(builder);
    let window = builder.build().map_err(|error| error.to_string())?;
    apply_native_material(&window).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn settings_window_ready(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("settings") else {
        return Ok(());
    };

    show_settings_window(&window)
}

#[tauri::command]
fn main_window_ready(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    show_window(&window)
}

fn show_window(window: &WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn show_settings_window(window: &WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn entry_path(root: &Path, date: &str) -> Result<PathBuf, String> {
    validate_iso_date(date)?;
    Ok(root.join("daily").join(date).join("daily.md"))
}

fn resolve_worklog_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(raw_root) = env::var("WORKLOG_ROOT") {
        let root = PathBuf::from(raw_root);
        fs::create_dir_all(root.join("daily")).map_err(|error| error.to_string())?;
        return Ok(root);
    }

    let cwd = env::current_dir().map_err(|error| error.to_string())?;
    for candidate in cwd.ancestors() {
        if candidate.join("daily").exists() {
            return Ok(candidate.to_path_buf());
        }
    }

    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(app_dir.join("daily")).map_err(|error| error.to_string())?;
    Ok(app_dir)
}

fn validate_iso_date(date: &str) -> Result<(), String> {
    let bytes = date.as_bytes();
    let valid_shape = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());

    if !valid_shape {
        return Err(format!("日期格式无效: {date}"));
    }

    let month: u8 = date[5..7]
        .parse()
        .map_err(|_| format!("日期格式无效: {date}"))?;
    let day: u8 = date[8..10]
        .parse()
        .map_err(|_| format!("日期格式无效: {date}"))?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(format!("日期格式无效: {date}"));
    }

    Ok(())
}

fn daily_template(date: &str) -> String {
    let _ = date;
    String::new()
}

fn apply_native_material(window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        window.set_effects(
            EffectsBuilder::new()
                .effect(Effect::Sidebar)
                .state(EffectState::FollowsWindowActiveState)
                .build(),
        )?;
    }

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(main_window_config) = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
            {
                let builder = WebviewWindowBuilder::from_config(app.handle(), main_window_config)?
                    .visible(false);
                let window = with_release_context_menu_disabled(builder).build()?;

                apply_native_material(&window)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_entries,
            read_entry,
            create_entry,
            save_entry,
            open_settings_window,
            main_window_ready,
            settings_window_ready
        ])
        .run(tauri::generate_context!())
        .expect("error while running worklog");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_template_is_blank() {
        assert_eq!(daily_template("2026-07-02"), "");
    }
}
