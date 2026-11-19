import { ChevronLeft, Code2, ExternalLink, Github, Globe, Heart, MessageCircle } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import logo from '../assets/logo.png'

export default function ThankYouView(): JSX.Element {
  const { setActiveView, previousView } = useStorePick('setActiveView', 'previousView')
  const backView = previousView && previousView !== 'thanks' ? previousView : 'home'

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto pb-player">
      <div className="sticky top-0 z-10 shrink-0 px-4 pt-3">
        <button
          onClick={() => setActiveView(backView)}
          aria-label="Back"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--fill)] hover:bg-[var(--fill-strong)] text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          <ChevronLeft size={15} /> Back
        </button>
      </div>

      <div className="relative w-full max-w-2xl mx-auto px-5 md:px-8 pt-6 md:pt-14 pb-16 text-center">
        <div aria-hidden className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-[460px] max-w-full h-[260px] rounded-full bg-accent/20 blur-[110px]" />

        <div className="relative">
          <img src={logo} alt="" className="w-16 h-16 mx-auto object-contain drop-shadow-2xl mb-5" />
          <p className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-accent mb-2">999 · Desktop Edition</p>
          <h1 className="text-text-primary text-3xl md:text-4xl font-extrabold tracking-tight mb-3">
            Built for the Vault.
          </h1>
          <p className="text-text-secondary text-sm md:text-base leading-relaxed max-w-lg mx-auto mb-10">
            Unreleased Glass is a dedicated desktop player crafted to experience Juice WRLD’s unreleased catalogue, studio sessions, archives, and live lyrics the way they deserve to be heard.
          </p>

          <div className="rounded-2xl border border-[var(--border)] bg-surface-overlay/50 p-6 md:p-7 text-left space-y-5">
            <div>
              <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-text-muted flex items-center gap-1.5 mb-2">
                <Code2 size={12} className="text-accent" /> Built by
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-text-primary text-lg font-bold">GoodFight37</h2>
                  <p className="text-text-secondary text-xs mt-0.5 flex items-center gap-1.5">
                    <MessageCircle size={12} className="text-accent" />
                    Discord: <span className="font-mono-ui font-semibold text-text-primary">WRLDMLK</span>
                  </p>
                </div>
                <a
                  href="https://github.com/GoodFight37/Unreleased"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[var(--fill)] hover:bg-[var(--fill-strong)] border border-[var(--border)] text-xs font-semibold text-text-primary transition-colors"
                >
                  <Github size={14} /> GoodFight37/Unreleased <ExternalLink size={11} className="opacity-65" />
                </a>
              </div>
            </div>

            <div className="pt-5 border-t border-[var(--border)]">
              <p className="font-mono-ui text-[10px] uppercase tracking-[0.18em] text-text-muted flex items-center gap-1.5 mb-2">
                <Heart size={12} className="text-accent" /> Original foundation & API
              </p>
              <p className="text-text-secondary text-xs leading-relaxed">
                Massive thanks to the creators of the original <span className="text-text-primary font-medium">Unreleased</span> player and the <span className="text-text-primary font-medium">Juice WRLD API</span> team for building and maintaining the catalogue, archive files, and API that power this app.
              </p>
              <div className="flex flex-wrap gap-2 mt-3.5">
                <a
                  href="https://juicewrldapi.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--fill)] hover:bg-[var(--fill-strong)] text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                >
                  <Globe size={13} /> juicewrldapi.com
                </a>
                <a
                  href="https://github.com/Juice-WRLD-API/Unreleased"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--fill)] hover:bg-[var(--fill-strong)] text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                >
                  <Github size={13} /> Original upstream repo
                </a>
              </div>
            </div>
          </div>

          <p className="font-mono-ui text-[11px] text-text-muted tracking-widest uppercase mt-8">
            999 Forever
          </p>
        </div>
      </div>
    </div>
  )
}
