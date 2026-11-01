# Spacing in Owlet

Owlet is a dense desktop tool for inspecting files. Repeated controls use predictable spacing while documents retain
enough room to read. Interface spacing uses six values: **2, 4, 8, 12, 16, and 24 px**.

- 2 px separates nested controls and provides minimal row padding.
- 4 px groups controls within toolbars and lists.
- 8 px provides compact control insets.
- 12 px aligns labels and Explorer indentation.
- 16 px separates sections and provides dialog padding.
- 24 px provides document and outer layout spacing.

CSS custom properties in `src/styles.css` are shared by `src/palette.css` and the editor theme.
Component dimensions are separate: Explorer rows are 22 px, compact controls 24 px, and tabs, toolbars, and palette rows
28 px. The Windows title bar remains 32 px. Borders, icon dimensions, type sizes, and corner radii are not spacing steps.

The previous interface used 30 distinct pixel values across padding, margins, and gaps. Explorer rows were 29 px and palette
rows 36 px. The denser rows fit about 32% more files and 29% more commands into the same list height.

Markdown uses a 1.65 line height and 16–24 px outer padding. Source and terminal insets use the same spacing scale.
The xterm mount remains unpadded because its fit calculation requires the exact available dimensions.

Run `node tests/spacing.cjs` to check row heights, palette bounds, and terminal fit at 1366×768 and 1024×600.
