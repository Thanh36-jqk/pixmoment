/**
 * Generate iOS Shortcut file (.shortcut = XML plist)
 * iOS Shortcuts picks HEIC photos in original format — bypasses browser conversion
 */
const { writeFileSync, mkdirSync } = require("fs");
const { randomUUID } = require("crypto");

const ID = () => randomUUID().toUpperCase();

const getPhotosUUID = ID();
const askTitleUUID  = ID();
const repeatUUID    = ID();
const uploadUUID    = ID();
const getDictUUID   = ID();
const appendUUID    = ID();
const endRepeatUUID = ID();
const postAlbumUUID = ID();
const getIdUUID     = ID();
const buildUrlUUID  = ID();
const copyUUID      = ID();
const showUUID      = ID();

const UPLOAD_URL = "https://pixmoment.vercel.app/api/upload-raw";
const ALBUMS_URL = "https://pixmoment.vercel.app/api/albums";
const BASE_URL   = "https://pixmoment.vercel.app/album/";

// Helpers to build plist XML fragments
const str  = (v)  => `<string>${v}</string>`;
const int  = (v)  => `<integer>${v}</integer>`;
const bool = (v)  => v ? `<true/>` : `<false/>`;
const key  = (k)  => `<key>${k}</key>`;
const arr  = (items) => `<array>\n${items.join("\n")}\n</array>`;
const dict = (pairs) => `<dict>\n${pairs.join("\n")}\n</dict>`;

// Token attachment (reference a variable by name)
const tokenVar = (name) => dict([
  key("Value"), dict([
    key("Type"),         str("Variable"),
    key("VariableName"), str(name),
  ]),
  key("WFSerializationType"), str("WFTextTokenAttachment"),
]);

// Token attachment (reference an action output by name + uuid)
const tokenOutput = (name, uuid) => dict([
  key("Value"), dict([
    key("Type"),       str("ActionOutput"),
    key("OutputName"), str(name),
    key("OutputUUID"), str(uuid),
  ]),
  key("WFSerializationType"), str("WFTextTokenAttachment"),
]);

// Token string (literal string)
const tokenStr = (s) => dict([
  key("Value"), dict([key("string"), str(s)]),
  key("WFSerializationType"), str("WFTextTokenString"),
]);

// HTTP header dict item
const headerItem = (k_str, v_str) => dict([
  key("WFItemType"), int(0),
  key("WFKey"),      tokenStr(k_str),
  key("WFValue"),    tokenStr(v_str),
]);

// A dictionary of headers wrapped in WFSerializationType
const headers = (...items) => dict([
  key("Value"), dict([
    key("WFDictionaryFieldValueItems"),
    arr(items),
  ]),
  key("WFSerializationType"), str("WFDictionaryFieldValue"),
]);

// JSON body for album POST
const albumJsonBody = () => dict([
  key("Value"), dict([
    key("WFDictionaryFieldValueItems"), arr([
      dict([
        key("WFItemType"), int(0),
        key("WFKey"),      tokenStr("title"),
        key("WFValue"),    tokenVar("AlbumTitle"),
      ]),
      dict([
        key("WFItemType"), int(0),
        key("WFKey"),      tokenStr("expiresIn"),
        key("WFValue"),    tokenStr("never"),
      ]),
    ]),
  ]),
  key("WFSerializationType"), str("WFDictionaryFieldValue"),
]);

// Build URL text with inline variable attachment
const buildUrlText = () => dict([
  key("Value"), dict([
    key("attachmentsByRange"), dict([
      key(`{${BASE_URL.length}, 1}`), dict([
        key("Type"),       str("ActionOutput"),
        key("OutputName"), str("AlbumID"),
        key("OutputUUID"), str(getIdUUID),
      ]),
    ]),
    key("string"), str(BASE_URL + "￼"), // ￼ = object replacement char
  ]),
  key("WFSerializationType"), str("WFTextTokenString"),
]);

// Show result text with inline URL
const showResultText = () => dict([
  key("Value"), dict([
    key("attachmentsByRange"), dict([
      key("{21, 1}"), dict([
        key("Type"),       str("ActionOutput"),
        key("OutputName"), str("AlbumURL"),
        key("OutputUUID"), str(buildUrlUUID),
      ]),
    ]),
    key("string"), str("✅ Album sẵn sàng!\n￼\n\nLink đã copy vào clipboard 📋\nGửi cho người yêu thôi! 💕"),
  ]),
  key("WFSerializationType"), str("WFTextTokenString"),
]);

// ── Shortcut actions ──
const actions = arr([

  // 1. Pick photos (returns HEIC originals — Shortcuts bypasses browser HEIC→JPEG conversion)
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.getphoto"),
    key("WFWorkflowActionParameters"), dict([
      key("UUID"),              str(getPhotosUUID),
      key("CustomOutputName"), str("Photos"),
      key("WFGetPhotoActionType"), str("Prompt"),
      key("SelectMultiple"),   bool(true),
    ]),
  ]),

  // 2. Ask for album name
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.ask"),
    key("WFWorkflowActionParameters"), dict([
      key("UUID"),                     str(askTitleUUID),
      key("CustomOutputName"),         str("AlbumTitle"),
      key("WFAskActionPrompt"),        str("Tên album?"),
      key("WFAskActionDefaultAnswer"), str("Album của chúng mình 💕"),
      key("WFAskActionInputType"),     str("Text"),
    ]),
  ]),

  // 3. Store title in variable
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.setvariable"),
    key("WFWorkflowActionParameters"), dict([
      key("WFVariableName"), str("AlbumTitle"),
      key("WFInput"),        tokenOutput("AlbumTitle", askTitleUUID),
    ]),
  ]),

  // 4. Repeat with Each photo
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.repeat.each"),
    key("WFWorkflowActionParameters"), dict([
      key("UUID"),    str(repeatUUID),
      key("WFInput"), tokenOutput("Photos", getPhotosUUID),
    ]),
  ]),

  // 5. Upload raw binary to /api/upload-raw
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.downloadurl"),
    key("WFWorkflowActionParameters"), dict([
      key("UUID"),             str(uploadUUID),
      key("CustomOutputName"), str("UploadResponse"),
      key("WFHTTPMethod"),     str("POST"),
      key("WFURL"),            str(UPLOAD_URL),
      key("WFHTTPBodyType"),   str("File"),
      key("WFRequestVariable"), dict([
        key("Value"), dict([
          key("Type"),       str("ActionOutput"),
          key("OutputName"), str("Repeat Item"),
          key("OutputUUID"), str(repeatUUID),
        ]),
        key("WFSerializationType"), str("WFTextTokenAttachment"),
      ]),
      key("WFHTTPHeaders"), headers(
        headerItem("X-Filename",   "photo.heic"),
        headerItem("Content-Type", "image/heic"),
      ),
    ]),
  ]),

  // 6. Get "url" from upload response
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.getdictionaryvalue"),
    key("WFWorkflowActionParameters"), dict([
      key("UUID"),             str(getDictUUID),
      key("CustomOutputName"), str("PhotoURL"),
      key("WFInput"),          tokenOutput("UploadResponse", uploadUUID),
      key("WFDictionaryKey"),  str("url"),
    ]),
  ]),

  // 7. Append URL to UploadedURLs list
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.appendvariable"),
    key("WFWorkflowActionParameters"), dict([
      key("UUID"),          str(appendUUID),
      key("WFVariableName"), str("UploadedURLs"),
      key("WFInput"),       tokenOutput("PhotoURL", getDictUUID),
    ]),
  ]),

  // 8. End Repeat
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.repeat.each.end"),
    key("WFWorkflowActionParameters"), dict([key("UUID"), str(endRepeatUUID)]),
  ]),

  // 9. POST to /api/albums
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.downloadurl"),
    key("WFWorkflowActionParameters"), dict([
      key("UUID"),             str(postAlbumUUID),
      key("CustomOutputName"), str("AlbumResponse"),
      key("WFHTTPMethod"),     str("POST"),
      key("WFURL"),            str(ALBUMS_URL),
      key("WFHTTPBodyType"),   str("JSON"),
      key("WFJSONValues"),     albumJsonBody(),
      key("WFHTTPHeaders"), headers(
        headerItem("Content-Type", "application/json"),
      ),
    ]),
  ]),

  // 10. Get album ID
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.getdictionaryvalue"),
    key("WFWorkflowActionParameters"), dict([
      key("UUID"),             str(getIdUUID),
      key("CustomOutputName"), str("AlbumID"),
      key("WFInput"),          tokenOutput("AlbumResponse", postAlbumUUID),
      key("WFDictionaryKey"),  str("id"),
    ]),
  ]),

  // 11. Build album URL text
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.text"),
    key("WFWorkflowActionParameters"), dict([
      key("UUID"),              str(buildUrlUUID),
      key("CustomOutputName"), str("AlbumURL"),
      key("WFTextActionText"), buildUrlText(),
    ]),
  ]),

  // 12. Copy to clipboard
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.setclipboard"),
    key("WFWorkflowActionParameters"), dict([
      key("UUID"),    str(copyUUID),
      key("WFInput"), tokenOutput("AlbumURL", buildUrlUUID),
    ]),
  ]),

  // 13. Show result
  dict([
    key("WFWorkflowActionIdentifier"), str("is.workflow.actions.showresult"),
    key("WFWorkflowActionParameters"), dict([
      key("UUID"), str(showUUID),
      key("Text"), showResultText(),
    ]),
  ]),
]);

const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${dict([
  key("WFWorkflowClientVersion"),           str("1300.0.1"),
  key("WFWorkflowMinimumClientVersion"),    int(900),
  key("WFWorkflowMinimumClientVersionString"), str("900"),
  key("WFWorkflowHasShortcutInputVariables"), bool(false),
  key("WFWorkflowIcon"), dict([
    key("WFWorkflowIconStartColor"), int(946986751),
    key("WFWorkflowIconGlyphNumber"), int(59511),
  ]),
  key("WFWorkflowImportQuestions"),         arr([]),
  key("WFWorkflowInputContentItemClasses"), arr([]),
  key("WFWorkflowName"),                    str("Pixmoment Upload"),
  key("WFWorkflowTypes"),                   arr([]),
  key("WFWorkflowActions"),                 actions,
])}
</plist>`;

mkdirSync("public", { recursive: true });
writeFileSync("public/PixmomentUpload.shortcut", plistXml, "utf8");
console.log("✅ Shortcut generated → public/PixmomentUpload.shortcut");
console.log(`   ${plistXml.length} bytes`);
