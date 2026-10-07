import {
  AudioLines,
  Music2,
  Piano,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
export default function Features() {
  const features = [
    {
      icon: AudioLines,
      title: "Escucha con contexto",
      text: "Waveform, selección de regiones, zoom, espectrograma y características acústicas de Meyda para tu archivo real.",
      detail: "WaveSurfer · Web Audio · Meyda",
    },
    {
      icon: Piano,
      title: "Un editor para tus notas",
      text: "Importa MIDI, crea pistas, ajusta pitch y velocity, divide o une notas, cuantiza y recorre el historial de cambios.",
      detail: "Zustand · Tone.js · MIDI",
    },
    {
      icon: Music2,
      title: "Partituras desde eventos",
      text: "MusicXML individual o global, voces, silencios y ligaduras entre compases. Vista legible o timing interpretado.",
      detail: "OpenSheetMusicDisplay · VexFlow · Verovio",
    },
    {
      icon: Sparkles,
      title: "IA con evidencia",
      text: "El motor de transcripción produce candidatos. Gemini revisa inconsistencias sin añadir notas ni afirmar procedencia de hardware.",
      detail: "Adaptadores de audio · Gemini",
    },
    {
      icon: Workflow,
      title: "Procesamiento asíncrono",
      text: "Los trabajos reservan minutos, evitan el doble consumo y liberan la reserva si fallan o se cancelan.",
      detail: "Cloud Tasks · Cloud Run · FFmpeg",
    },
    {
      icon: ShieldCheck,
      title: "Privacidad y control",
      text: "Sesiones verificadas, App Check, acceso por propietario y enlaces firmados con caducidad. Descarga antes de la expiración.",
      detail: "Firebase Auth · Firestore · Storage temporal",
    },
  ];
  return (
    <>
      <div className="content-page">
        <div className="eyebrow">HERRAMIENTAS CON PROPÓSITO</div>
        <h1>Entiende lo que escuchas.</h1>
        <p className="page-subtitle">
          Una fuente de verdad para audio, eventos y notación. La transcripción
          automática requiere configurar un proveedor especializado; ninguna
          herramienta promete precisión perfecta.
        </p>
        <div className="feature-grid">
          {features.map((f) => (
            <section className="feature-card" key={f.title}>
              <f.icon size={25} />
              <h2>{f.title}</h2>
              <p>{f.text}</p>
              <small>{f.detail}</small>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
