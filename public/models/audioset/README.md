# AudioSet reference metadata

Source: Google AudioSet ontology, https://github.com/audioset/ontology.
The exact source revision is recorded in `provenance.json`.

`ontology.json` is the unmodified upstream ontology. `reference-pages.json`
records the class names and URLs published in the official AudioSet ontology
index at https://research.google.com/audioset/ontology/index.html (retrieved
2026-10-06). It contains metadata, not downloaded YouTube recordings.

`scripts/prepare-audioset.mjs` joins the ontology to the bundled official
YAMNet class IDs and generates `lib/audio/transcription/audioset-catalog.json`.
The catalog includes 87 supported musical categories: instruments, families,
techniques and singing. Categories absent from YAMNet are not inferred.
Spanish translations and the generated catalog are adaptations distributed
under the ontology's CC BY-SA 4.0 license, with attribution to Google Inc.
See LICENSE and https://research.google.com/audioset/download.html.

YAMNet uses learned AudioSet patterns to classify uploaded audio locally.
Opening a reference lets a person compare official examples. This is not
an online nearest-recording search, a new trained model, stem separation,
or guaranteed identification of every instrument in a mixture.

Some external example videos may have been removed or become unavailable.
