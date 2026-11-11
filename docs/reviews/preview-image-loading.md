# Embedded figure loading feedback

An embedded figure could take tens of seconds to arrive over SSH while the preview showed only its caption, making a valid
relative path look broken. Each figure now starts with a compact placeholder, spinner and **Loading image…** status. After the
file arrives it switches to **Rendering image…** until the browser loads it. Success removes the status and enables expansion;
transfer/path errors and invalid image data remove the spinner and show the existing error message.

The caption remains visible, reduced-motion preferences disable spinner animation, and Find excludes these temporary status
labels. This does not estimate a percentage or change the image transfer protocol. Mermaid already shows **Rendering diagram…**.

Validation includes a controlled delayed transfer, document-relative paths, successful rendering, missing files, invalid image
bytes, accessibility busy state, reduced motion, Find exclusion and expansion after loading. Existing expanded-image behavior
is checked, and the reported remote document is inspected in an isolated window without editing it.
