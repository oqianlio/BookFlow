use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

/// 从 EPUB 中提取封面图，保存到 books 目录（`<书名>_cover.<ext>`），返回保存路径。
/// 解析 META-INF/container.xml -> OPF -> manifest（cover-image 属性 / meta cover / id=cover）。
/// 提取失败时返回 None，不影响书籍导入。
pub fn extract_epub_cover(epub_path: &Path, books_root: &Path) -> Option<PathBuf> {
    let file = File::open(epub_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;

    let container = read_entry(&mut archive, "META-INF/container.xml")?;
    let opf = attr(&container, "full-path")?;
    let opf_xml = read_entry(&mut archive, &opf)?;

    let manifest = between(&opf_xml, "<manifest", "</manifest>")?;
    // id -> (href, properties)
    let mut items: HashMap<String, (String, String)> = HashMap::new();
    let mut rest = manifest;
    while let Some(i) = rest.find("<item") {
        let after = &rest[i..];
        let end = after.find('>')?;
        let tag = &after[..end];
        if let (Some(id), Some(href)) = (attr(tag, "id"), attr(tag, "href")) {
            items.insert(id.clone(), (href, attr(tag, "properties").unwrap_or_default()));
        }
        rest = &after[end..];
    }

    let cover_id = find_cover_id(&opf_xml, &items)?;
    let (href, _) = items.get(&cover_id)?;
    let archive_path = resolve_relative_path(&parent_dir(&opf), href);
    let bytes = read_entry_bytes(&mut archive, &archive_path)?;
    if bytes.len() < 16 {
        return None;
    }
    let ext = Path::new(href)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| "png".into());
    let stem = epub_path.file_stem()?.to_string_lossy().into_owned();
    let dest = unique_cover_dest(books_root, &stem, &ext);
    std::fs::write(&dest, &bytes).ok()?;
    Some(dest)
}

fn find_cover_id(opf: &str, items: &HashMap<String, (String, String)>) -> Option<String> {
    // <meta name="cover" content="cover-id"/>
    if let Some(metadata) = between(opf, "<metadata", "</metadata>") {
        let mut rest = metadata;
        while let Some(i) = rest.find("<meta") {
            let after = &rest[i..];
            let end = after.find('>')?;
            let tag = &after[..end];
            if let (Some(name), Some(content)) = (attr(tag, "name"), attr(tag, "content")) {
                if name.eq_ignore_ascii_case("cover") && items.contains_key(&content) {
                    return Some(content);
                }
            }
            rest = &after[end..];
        }
    }
    // properties="cover-image"
    for (id, (_, props)) in items {
        if props.split_whitespace().any(|p| p.eq_ignore_ascii_case("cover-image")) {
            return Some(id.clone());
        }
    }
    // id="cover"
    for id in items.keys() {
        if id.eq_ignore_ascii_case("cover") {
            return Some(id.clone());
        }
    }
    None
}

fn unique_cover_dest(books_root: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut dest = books_root.join(format!("{stem}_cover.{ext}"));
    let mut i = 1;
    while dest.exists() {
        dest = books_root.join(format!("{stem}_cover_{i}.{ext}"));
        i += 1;
    }
    dest
}

fn read_entry(archive: &mut zip::ZipArchive<File>, name: &str) -> Option<String> {
    let mut f = archive.by_name(name).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    Some(s)
}

fn read_entry_bytes(archive: &mut zip::ZipArchive<File>, name: &str) -> Option<Vec<u8>> {
    let mut f = archive.by_name(name).ok()?;
    let mut v = Vec::new();
    f.read_to_end(&mut v).ok()?;
    Some(v)
}

fn between<'a>(s: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let i = s.find(start)?;
    let rest = &s[i + start.len()..];
    let j = rest.find(end)?;
    Some(&rest[..j])
}

fn attr(s: &str, name: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let pat = format!("{name}={quote}");
        if let Some(i) = s.find(&pat) {
            let rest = &s[i + pat.len()..];
            let end = rest.find(quote)?;
            return Some(rest[..end].to_string());
        }
    }
    None
}

fn parent_dir(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

fn resolve_relative_path(base_dir: &str, href: &str) -> String {
    let combined = if base_dir.is_empty() {
        href.to_string()
    } else {
        format!("{base_dir}/{href}")
    };
    let mut parts: Vec<&str> = Vec::new();
    for seg in combined.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 构造一个最小的 EPUB：container.xml + OPF + 一张 PNG 封面
    fn build_minimal_epub(dir: &Path) -> PathBuf {
        let epub = dir.join("book.epub");
        let file = File::create(&epub).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("META-INF/container.xml", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#.as_bytes()).unwrap();
        zip.start_file("OEBPS/content.opf", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">test</dc:identifier>
    <dc:title>测试书</dc:title>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="c1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
  </spine>
</package>"#.as_bytes()).unwrap();
        zip.start_file("OEBPS/images/cover.png", zip::write::SimpleFileOptions::default()).unwrap();
        // 模拟 PNG 头 + 填充数据（≥16 字节，通过最小长度校验）
        let mut png = vec![0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        png.resize(64, 0x00);
        zip.write_all(&png).unwrap();
        zip.finish().unwrap();
        epub
    }

    #[test]
    fn extract_cover_from_epub() {
        let dir = tempfile::tempdir().unwrap();
        let epub = build_minimal_epub(dir.path());
        let books_root = dir.path().join("books");
        std::fs::create_dir(&books_root).unwrap();
        let cover = extract_epub_cover(&epub, &books_root).unwrap();
        assert!(cover.exists());
        assert!(cover.to_string_lossy().ends_with("_cover.png"));
        let bytes = std::fs::read(&cover).unwrap();
        assert!(bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]));
        std::fs::remove_dir_all(dir.path()).unwrap();
    }

    #[test]
    fn extract_cover_missing_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nope.epub");
        std::fs::write(&p, "not a zip").unwrap();
        assert!(extract_epub_cover(&p, dir.path()).is_none());
    }
}
