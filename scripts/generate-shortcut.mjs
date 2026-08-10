import { build as buildPlist } from "E:/pixmoment/node_modules/plist/dist/build.js";
import { writeFileSync } from "fs";
import { randomUUID } from "crypto";

// UUIDs for each action (required by iOS Shortcuts for variable references)
const ID = () => randomUUID().toUpperCase();

const getPhotosUUID = ID();
const askTitleUUID  = ID();
const setTitleUUID  = ID();
const repeatUUID    = ID();
const uploadUUID    = ID();
const getDictUUID   = ID();
const appendUUID    = ID();
const endRepeatUUID = ID();
const buildArrUUID  = ID();
const buildBodyUUID = ID();
const postAlbumUUID = ID();
const getIdUUID     = ID();
const buildUrlUUID  = ID();
const copyUUID      = ID();
const showUUID      = ID();

function tokenVar(name) {
  return {
    Value: { Type: "Variable", VariableName: name },
    WFSerializationType: "WFTextTokenAttachment",
  };
}

function tokenOutput(name, uuid) {
  return {
    Value: { Type: "ActionOutput", OutputName: name, OutputUUID: uuid },
    WFSerializationType: "WFTextTokenAttachment",
  };
}

function tokenString(str) {
  return {
    Value: { string: str },
    WFSerializationType: "WFTextTokenString",
  };
}

const UPLOAD_URL = "https://pixmoment.vercel.app/api/upload-raw";
const ALBUMS_URL = "https://pixmoment.vercel.app/api/albums";

const shortcut = {
  WFWorkflowClientVersion: "1300.0.1",
  WFWorkflowMinimumClientVersion: 900,
  WFWorkflowMinimumClientVersionString: "900",
  WFWorkflowHasShortcutInputVariables: false,
  WFWorkflowIcon: {
    WFWorkflowIconStartColor: 946986751,  // Purple
    WFWorkflowIconGlyphNumber: 59511,      // Photo icon
  },
  WFWorkflowImportQuestions: [],
  WFWorkflowInputContentItemClasses: [],
  WFWorkflowName: "Pixmoment Upload",
  WFWorkflowTypes: [],
  WFWorkflowActions: [

    // ── 1. Pick photos (returns HEIC originals, bypasses browser conversion) ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.getphoto",
      WFWorkflowActionParameters: {
        UUID: getPhotosUUID,
        CustomOutputName: "Photos",
        WFGetPhotoActionType: "Prompt",
        SelectMultiple: true,
        SelectionLimit: 50,
      },
    },

    // ── 2. Ask for album name ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.ask",
      WFWorkflowActionParameters: {
        UUID: askTitleUUID,
        CustomOutputName: "AlbumTitle",
        WFAskActionPrompt: "Tên album?",
        WFAskActionDefaultAnswer: "Album của chúng mình 💕",
        WFAskActionInputType: "Text",
      },
    },

    // ── 3. Store album title ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.setvariable",
      WFWorkflowActionParameters: {
        UUID: setTitleUUID,
        WFVariableName: "AlbumTitle",
        WFInput: tokenOutput("AlbumTitle", askTitleUUID),
      },
    },

    // ── 4. Repeat with Each photo ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each",
      WFWorkflowActionParameters: {
        UUID: repeatUUID,
        WFInput: tokenOutput("Photos", getPhotosUUID),
      },
    },

    // ── 5. Upload photo as raw binary to /api/upload-raw ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.downloadurl",
      WFWorkflowActionParameters: {
        UUID: uploadUUID,
        CustomOutputName: "UploadResponse",
        WFHTTPMethod: "POST",
        WFURL: UPLOAD_URL,
        WFHTTPBodyType: "File",
        WFRequestVariable: {
          Value: { Type: "ActionOutput", OutputName: "Repeat Item", OutputUUID: repeatUUID },
          WFSerializationType: "WFTextTokenAttachment",
        },
        WFHTTPHeaders: {
          Value: {
            WFDictionaryFieldValueItems: [
              {
                WFItemType: 0,
                WFKey: tokenString("X-Filename"),
                WFValue: {
                  Value: { string: "photo.heic" },
                  WFSerializationType: "WFTextTokenString",
                },
              },
            ],
          },
          WFSerializationType: "WFDictionaryFieldValue",
        },
      },
    },

    // ── 6. Get "url" from upload response ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.getdictionaryvalue",
      WFWorkflowActionParameters: {
        UUID: getDictUUID,
        CustomOutputName: "PhotoURL",
        WFInput: tokenOutput("UploadResponse", uploadUUID),
        WFDictionaryKey: "url",
      },
    },

    // ── 7. Add URL to UploadedURLs variable ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.appendvariable",
      WFWorkflowActionParameters: {
        UUID: appendUUID,
        WFVariableName: "UploadedURLs",
        WFInput: tokenOutput("PhotoURL", getDictUUID),
      },
    },

    // ── 8. End repeat ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each.end",
      WFWorkflowActionParameters: { UUID: endRepeatUUID },
    },

    // ── 9. Build photos JSON array ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.text",
      WFWorkflowActionParameters: {
        UUID: buildArrUUID,
        CustomOutputName: "PhotosJSON",
        WFTextActionText: {
          Value: {
            attachmentsByRange: {
              "{0, 1}": {
                Type: "Variable",
                VariableName: "UploadedURLs",
              },
            },
            string: "￼",
          },
          WFSerializationType: "WFTextTokenString",
        },
      },
    },

    // ── 10. Build album JSON body ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.dictionary",
      WFWorkflowActionParameters: {
        UUID: buildBodyUUID,
        CustomOutputName: "AlbumBody",
        WFItems: {
          Value: {
            WFDictionaryFieldValueItems: [
              {
                WFItemType: 0,
                WFKey: tokenString("title"),
                WFValue: tokenVar("AlbumTitle"),
              },
              {
                WFItemType: 0,
                WFKey: tokenString("expiresIn"),
                WFValue: { Value: { string: "never" }, WFSerializationType: "WFTextTokenString" },
              },
            ],
          },
          WFSerializationType: "WFDictionaryFieldValue",
        },
      },
    },

    // ── 11. POST to /api/albums ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.downloadurl",
      WFWorkflowActionParameters: {
        UUID: postAlbumUUID,
        CustomOutputName: "AlbumResponse",
        WFHTTPMethod: "POST",
        WFURL: ALBUMS_URL,
        WFHTTPBodyType: "JSON",
        WFJSONValues: tokenOutput("AlbumBody", buildBodyUUID),
      },
    },

    // ── 12. Get album ID ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.getdictionaryvalue",
      WFWorkflowActionParameters: {
        UUID: getIdUUID,
        CustomOutputName: "AlbumID",
        WFInput: tokenOutput("AlbumResponse", postAlbumUUID),
        WFDictionaryKey: "id",
      },
    },

    // ── 13. Build final URL ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.text",
      WFWorkflowActionParameters: {
        UUID: buildUrlUUID,
        CustomOutputName: "AlbumURL",
        WFTextActionText: {
          Value: {
            attachmentsByRange: {
              "{45, 1}": {
                Type: "ActionOutput",
                OutputName: "AlbumID",
                OutputUUID: getIdUUID,
              },
            },
            string: "https://pixmoment.vercel.app/album/￼",
          },
          WFSerializationType: "WFTextTokenString",
        },
      },
    },

    // ── 14. Copy link to clipboard ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.setclipboard",
      WFWorkflowActionParameters: {
        UUID: copyUUID,
        WFInput: tokenOutput("AlbumURL", buildUrlUUID),
      },
    },

    // ── 15. Show result ──
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.showresult",
      WFWorkflowActionParameters: {
        UUID: showUUID,
        Text: {
          Value: {
            attachmentsByRange: {
              "{25, 1}": {
                Type: "ActionOutput",
                OutputName: "AlbumURL",
                OutputUUID: buildUrlUUID,
              },
            },
            string: "✅ Album sẵn sàng!\n￼\n\nLink đã copy vào clipboard.",
          },
          WFSerializationType: "WFTextTokenString",
        },
      },
    },
  ],
};

const xml = buildPlist(shortcut);
writeFileSync("public/PixmomentUpload.shortcut", xml, "utf8");
console.log("✅ Shortcut generated at public/PixmomentUpload.shortcut");
