# Serialization and Asset Loading

Covers save formats, custom binary serialization, asset pipeline design, and level loading strategies. Read this when serializing game data, designing save formats, or loading levels/assets.

*Synthesized from [Jonathan Blow stream clips](https://www.youtube.com/@JBH-p5b) — full per-topic sources in [docs/sources/jonathan-blow.md](../../docs/sources/jonathan-blow.md).*

---

## Custom Serialization vs Generic Formats

Parsing is two distinct jobs: (a) reading primitives from bytes or text, and (b) validating the contents and placing data where it belongs. A generic format like JSON only does job (a). That leaves job (b) scattered across the rest of the program — every access site must re-check whether the field exists and handle the missing case. The uncertainty doesn't disappear; it diffuses.

The better approach is to validate everything at load time. Once the load function returns successfully, there is zero uncertainty about what exists and where. Downstream code can assume the data is present and well-formed.

Jonathan Blow argues that JSON and XML are overrated for game data precisely because they push this validation burden onto the caller. A custom binary format or even a simple text format with a dedicated parser can do both jobs in one pass, eliminating the ambient uncertainty.

### Practical serialization techniques

**Default-value diffing.** Mark fields that override their default; unmarked fields take the default. When you change a default value, every entity that never overrode it gets the new default automatically — no migration needed. **Warning:** changing a default is a silent data mutation for all entities that inherited it. Treat default changes with the same care as schema migrations — audit all entities that rely on the old default before shipping.

**Versioned positional fields.** Stamp each field with the version number that introduced it. Keep deprecated fields in the struct while old save files still need to load; delete them only at ship time when backward compatibility is no longer required. *Scope: safe for single-player games with a hard version boundary. For live-service, early-access, or moddable games, treat field deletion as a breaking API change and version the format explicitly.*

**Hex floats.** Store floating-point values as hex strings (e.g., `0x1.8p+1`) rather than decimal. Decimal round-trips can silently drift; hex is exact.

**Save state as undo-stack plus entity diffs.** Campaign or save-game state is intentionally not forward-compatible — it records what happened, not a portable snapshot. An undo-stack of diffs is compact and makes the save format's purpose explicit.

---

## Asset and Level Loading

**One packed binary per level.** Per-entity files are a source-control convenience for developers, not a shipping format. At build time, pack everything for a level into a single binary. This reduces file-system overhead and makes the loading path trivial.

**Load the whole file, then parse** *(first-party assets only)*. Memory is abundant for assets you control. Read the entire file into a buffer with one call, then parse the buffer in memory. Jonathan Blow argues that incremental `fread`-and-parse loops are a red herring — the complexity they add is not justified by any real constraint. The OS will buffer the reads anyway; you gain nothing and add code. *For untrusted input (mods, downloaded content, user save files), enforce a size cap before allocating.*

**Parallelize with a filename queue.** Spawn N worker threads that pull filenames from a shared queue and read files. The main thread parses. This keeps I/O and parsing on separate cores without complex synchronization — workers only read, the main thread only parses.

**Two-field entity IDs.** Use a `(user-id, per-user-serial)` pair as the entity identifier. All entities belonging to one user group into one file, keeping the total file count low and making per-user operations cheap.

**Watch the Windows per-folder file-count cliff.** Windows performance degrades noticeably around 10,000 files in a single directory. If your asset pipeline generates per-entity files, bucket them into subdirectories before you hit that limit.

**Profile before optimizing.** If loading 7,000 entities takes two seconds, the bottleneck is almost certainly not raw I/O — it is more likely heap allocation behavior, float parsing, or an unexpected O(n²) lookup. Measure before reaching for a more complex loading strategy.

**mmap is usually a red herring.** Jonathan Blow's stance is that `mmap` offers no practical advantage when the OS already caches files in the page cache. The added complexity (pointer arithmetic into a mapped region, platform differences) is rarely worth it. Load into a heap buffer and parse.

---

## Dev vs Ship Pipeline

The source-control representation and the runtime representation should be different. During development, per-entity text files are convenient: they diff cleanly, merge without conflicts, and let designers edit individual records. At build time, a packing step merges them into per-level binaries. The runtime loader never sees the per-entity files.

This split also means the packing step is the natural place to run validation. Catch missing fields, out-of-range values, and broken references at build time, not at runtime on a player's machine. The packed binary is a contract: if it loaded, it is valid.

Keep the packer fast. If packing a level takes more than a few seconds, developers will skip it during iteration. A slow packer is a packer that gets bypassed, which defeats the purpose.

---

## Common Mistakes

**Validating lazily.** Checking for field existence at every call site instead of once at load time. The fix is a dedicated load function that validates and populates a typed struct; callers get the struct, not the raw data.

**Storing floats as decimal.** `3.14159265` parsed back from a string is not the same float you started with. Use hex float literals or store the raw bit pattern.

**Treating the save file as a database.** Save files record a specific game session's history. They are not meant to be forward-compatible or queryable. Trying to make them so adds complexity without benefit; accept that old saves may break across major versions.

**Over-threading the loader.** A single background thread reading files while the main thread parses is usually sufficient. Adding more threads helps only when I/O is the bottleneck, which it rarely is once the OS page cache is warm.

---

## When to Reach for a Custom Format

Use a custom format when:
- You need both parsing and validation in one pass.
- You want default-value diffing or versioned fields without a schema library.
- Load-time performance matters and you can afford a build step.

Stick with a generic format (JSON, TOML) when:
- The data is configuration that humans edit directly and rarely.
- Tooling interoperability matters more than load-time certainty.
- The dataset is small enough that diffuse validation is not a maintenance burden.
