// Derived ontology metadata: Google AudioSet, CC BY-SA 4.0.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const load = async (path) =>
  JSON.parse(await readFile(resolve(root, path), "utf8"));
const ontology = await load("public/models/audioset/ontology.json");
const pages = await load("public/models/audioset/reference-pages.json");
const classes = await load("public/models/yamnet/classes.json");
const nodes = new Map(ontology.map((node) => [node.id, node]));
const descendants = (id, seen = new Set()) => {
  if (seen.has(id)) return seen;
  seen.add(id);
  for (const child of nodes.get(id)?.child_ids ?? []) descendants(child, seen);
  return seen;
};
const musical = descendants("/m/04szw");
const singing = descendants("/m/015lz1");
const techniques = new Set([140, 141, 161, 162, 187, 202]);
const families = new Set([133, 134, 147, 156, 174, 179, 180, 184, 185, 190]);
const translations = {
  24: "Voz cantada",
  25: "Coro",
  26: "Canto a la tirolesa",
  27: "Canto repetitivo",
  28: "Mantra",
  29: "Voz infantil cantada",
  30: "Voz sintética cantada",
  31: "Rap",
  133: "Instrumento musical",
  134: "Cuerda pulsada",
  135: "Guitarra",
  136: "Guitarra eléctrica",
  137: "Bajo",
  138: "Guitarra acústica",
  139: "Guitarra de acero o slide",
  140: "Tapping de guitarra",
  141: "Rasgueo",
  142: "Banjo",
  143: "Sitar",
  144: "Mandolina",
  145: "Cítara",
  146: "Ukelele",
  147: "Teclados",
  148: "Piano",
  149: "Piano eléctrico",
  150: "Órgano",
  151: "Órgano electrónico",
  152: "Órgano Hammond",
  153: "Sintetizador",
  154: "Sampler",
  155: "Clave",
  156: "Percusión",
  157: "Batería",
  158: "Caja de ritmos",
  159: "Tambor",
  160: "Caja",
  161: "Golpe de aro",
  162: "Redoble",
  163: "Bombo",
  164: "Timbales",
  165: "Tabla",
  166: "Platillos",
  167: "Charles",
  168: "Bloque de madera",
  169: "Pandereta",
  170: "Sonajero",
  171: "Maraca",
  172: "Gong",
  173: "Campanas tubulares",
  174: "Percusión de láminas",
  175: "Marimba o xilófono",
  176: "Glockenspiel",
  177: "Vibráfono",
  178: "Tambor de acero",
  179: "Orquesta",
  180: "Viento metal",
  181: "Trompa",
  182: "Trompeta",
  183: "Trombón",
  184: "Cuerda frotada",
  185: "Sección de cuerdas",
  186: "Violín",
  187: "Pizzicato",
  188: "Violonchelo",
  189: "Contrabajo",
  190: "Viento madera",
  191: "Flauta",
  192: "Saxofón",
  193: "Clarinete",
  194: "Arpa",
  195: "Campana",
  196: "Campana de iglesia",
  197: "Cascabel",
  198: "Timbre de bicicleta",
  199: "Diapasón",
  200: "Carillón",
  201: "Campanillas de viento",
  202: "Repique de campanas",
  203: "Armónica",
  204: "Acordeón",
  205: "Gaita",
  206: "Didgeridoo",
  207: "Shofar",
  208: "Theremín",
  209: "Cuenco tibetano",
};
const catalog = classes
  .filter((entry) => musical.has(entry.mid) || singing.has(entry.mid))
  .map((entry) => {
    const node = nodes.get(entry.mid);
    const page = pages[node.name];
    if (!page) throw new Error(`Missing official reference: ${node.name}`);
    return {
      index: entry.index,
      audiosetId: entry.mid,
      label: entry.label,
      labelEs: translations[entry.index] ?? entry.label,
      kind: singing.has(entry.mid)
        ? "voice"
        : techniques.has(entry.index)
          ? "technique"
          : families.has(entry.index)
            ? "family"
            : "instrument",
      descendantIds: [...descendants(entry.mid)].filter(
        (id) => id !== entry.mid,
      ),
      referenceUrl: `https://research.google.com/audioset/ontology/${page}`,
    };
  });
if (
  !catalog.some(
    (entry) => entry.index === 148 && entry.audiosetId === "/m/05r5c",
  )
)
  throw new Error("Invalid piano mapping");
await writeFile(
  resolve(root, "lib/audio/transcription/audioset-catalog.json"),
  JSON.stringify(catalog, null, 2) + "\n",
);
console.log(
  `${catalog.length} categorías musicales de AudioSet disponibles en YAMNet.`,
);
