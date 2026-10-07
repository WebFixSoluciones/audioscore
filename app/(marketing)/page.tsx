import Link from "next/link";
import { Shell } from "@/components/layout/Shell";
import { FileMusic, ArrowRight, ArrowUpRight, ShieldCheck } from "lucide-react";
export default function Home() {
  return (
    <Shell>
      <div className="landing">
        <div className="eyebrow">
          <span className="tiny-dot violet" /> ESCUCHA. COMPRENDE. CREA.
        </div>
        <h1>
          Tu música tiene
          <br />
          mucho que decir.
          <br />
          <span>Dale forma.</span>
        </h1>
        <p className="lead">
          Un espacio para convertir audio en información musical, revisar cada
          nota y construir partituras que puedas seguir trabajando.
        </p>
        <div className="landing-actions">
          <Link className="button primary" href="/studio">
            Abrir estudio local <ArrowUpRight size={16} />
          </Link>
          <Link className="button secondary" href="/auth/register">
            Crear mi cuenta <ArrowRight size={15} />
          </Link>
        </div>
        <div
          className="landing-art"
          aria-label="Ilustración del flujo de audio a MIDI y partitura"
        >
          <div className="art-source">
            <div className="art-wave">
              {Array.from({ length: 39 }, (_, i) => (
                <i
                  key={i}
                  style={{
                    height:
                      8 +
                      Math.abs(Math.sin(i * 1.13) * Math.cos(i * 0.31)) * 47,
                  }}
                />
              ))}
            </div>
            <p>AUDIO</p>
          </div>
          <ArrowRight size={19} color="#9471b5" />
          <div className="art-source">
            <FileMusic size={45} strokeWidth={1} />
            <p>EVENTOS MUSICALES</p>
          </div>
          <ArrowRight size={19} color="#9471b5" />
          <div className="art-source">
            <div className="art-staff">
              {Array.from({ length: 5 }, (_, i) => (
                <i key={i} />
              ))}
              <strong>𝄞 ♪ ♫</strong>
            </div>
            <p>PARTITURA</p>
          </div>
        </div>
        <div className="landing-steps">
          <div className="landing-step">
            <small>01 / ESCUCHA</small>
            <h2>Cada detalle cuenta.</h2>
            <p>
              Abre tu audio, explora su waveform y selecciona las regiones que
              quieres trabajar.
            </p>
          </div>
          <div className="landing-step">
            <small>02 / REVISA</small>
            <h2>La confianza es visible.</h2>
            <p>
              Trabaja con evidencia, identifica las notas dudosas y corrige lo
              que necesita una escucha humana.
            </p>
          </div>
          <div className="landing-step">
            <small>03 / CREA</small>
            <h2>Tu música, a tu manera.</h2>
            <p>
              Edita eventos, visualiza la partitura y exporta MIDI, MusicXML y
              tus resultados temporales.
            </p>
          </div>
        </div>
        <p className="auth-promise">
          <ShieldCheck size={17} />
          La transcripción depende del motor de audio configurado. La revisión
          musical siempre importa.
        </p>
      </div>
    </Shell>
  );
}
