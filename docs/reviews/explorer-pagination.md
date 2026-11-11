# Explorer pagination order

Directory listings now sort the entire directory before returning each 100-entry page. Previously, each filesystem-order
page was sorted separately, so loading more entries could append folders after files or restart alphabetical ordering.
Both local and SSH listings keep folders first and names alphabetical across page boundaries, with deterministic tie-breaking.

Only 100 entries travel per SSH response. Sorting requires inspecting the directory's names first (no recursion or file-content
reads); local enumeration and metadata I/O are asynchronous. Listings are read fresh rather than cached. Pagination still uses
offsets, so concurrent directory changes can shift page boundaries; refresh restarts from the current first page.

Validated with 250 mixed entries across three pages, including button and command/API loading, refresh and no missing/duplicate
entries, locally and over real SSH. Existing local filesystem and Explorer reveal/selection regressions pass. Rendered ordering
at the folder/file boundary was inspected. The portable build is checked before updating the local launcher.
