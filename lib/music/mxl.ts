import { strToU8, zipSync } from "fflate";
import type { MusicDocument } from "./types";
import { writeMusicXML } from "./musicxml";

/** MusicXML 4 archive: the first member is an uncompressed MIME marker. */
export function writeMXL(
  document: MusicDocument,
  sourceId?: string,
  options: { readable?: boolean } = {},
): Uint8Array {
  return zipSync(
    {
      mimetype: [strToU8("application/vnd.recordare.musicxml"), { level: 0 }],
      "META-INF/container.xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
      ),
      "score.musicxml": strToU8(writeMusicXML(document, sourceId, options)),
    },
    { level: 6 },
  );
}
