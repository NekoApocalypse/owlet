# Expanded Markdown images

Images in Markdown now have the same full-window inspection experience as Mermaid diagrams: Expand, pointer-anchored wheel
zoom, drag/arrow-key pan, fit, actual size and Escape to close. Clicking an unlinked image also expands it. Linked images
retain navigation, with a separate Expand button. Closing restores focus to the originating control.

The shared viewer and navigation handlers serve both content types, with separate named commands and enabled states.
`preview.image.open({index?,group?})` targets a specific image/pane; every viewer control is also in the command palette.
The image is reused from the loaded preview, so expansion adds no SSH read. Markdown contents and whole-preview zoom remain
independent. No new backend, dependency, or remote helper is required.

Scope: images already supported and successfully rendered by Owlet's Markdown preview. Existing format/size restrictions
remain; this does not add SVG file rendering or remote web-image fetching. The separate image-file tab keeps its existing controls.

Validation: production build; `tests/expanded-images.cjs` locally and over configured SSH, plus the existing Mermaid/terminal
regression. Acceptance covers UI/API/palette paths, fit/zoom limits/pointer anchor, pan, keyboard controls, focus restoration,
linked-image navigation, split targeting, missing images, zero extra downloads, unchanged Markdown, and shared Mermaid behavior.
