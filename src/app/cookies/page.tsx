import type { Metadata } from "next";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { LegalPageShell, LegalSection } from "@/components/landing/legal-page-shell";
import { ManageCookiesButton } from "@/components/cookie-consent";

const LAST_UPDATED = "2026-09-29";

export const metadata: Metadata = {
  title: "Politique des Cookies — DIVA Association",
  description: "Politique relative à l'utilisation des cookies et traceurs sur la plateforme DIVA Association.",
};

export default async function CookiesPolicyPage() {
  const lang = await getLang();
  const isFr = lang === "fr";

  return (
    <LegalPageShell
      lang={lang}
      title={isFr ? "Politique relative aux cookies" : "Cookie Policy"}
      lastUpdated={isFr ? `Dernière mise à jour : ${LAST_UPDATED}` : `Last updated: ${LAST_UPDATED}`}
    >
      <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="font-title-sm text-sm font-bold text-primary">
            {isFr ? "Gérer votre consentement" : "Manage Your Consent"}
          </h3>
          <p className="font-body-sm text-xs text-on-surface-variant mt-0.5">
            {isFr
              ? "Vous pouvez à tout moment revoir et ajuster vos préférences de cookies."
              : "You can review and adjust your cookie preferences at any time."}
          </p>
        </div>
        <ManageCookiesButton
          lang={lang}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-label-md text-xs font-bold hover:opacity-90 active:scale-95 transition-all shadow-xs cursor-pointer flex-shrink-0"
        />
      </div>

      <LegalSection
        title={isFr ? "1. Qu'est-ce qu'un cookie ?" : "1. What is a Cookie?"}
        body={
          isFr
            ? "Un cookie est un petit fichier texte déposé sur votre terminal (ordinateur, tablette ou smartphone) lors de la visite d'un site web ou de l'utilisation d'une application. Il permet à l'application de mémoriser vos actions et préférences (comme vos identifiants de connexion, votre langue et vos options d'affichage) pendant une période donnée."
            : "A cookie is a small text file placed on your device (computer, tablet, or smartphone) when you visit a website or application. It enables the application to remember your actions and preferences (such as authentication sessions, language choice, and display settings) over a period of time."
        }
      />

      <LegalSection
        title={isFr ? "2. Catégories de cookies que nous utilisons" : "2. Cookie Categories We Use"}
        body={
          isFr
            ? "• Cookies strictement nécessaires : Indispensables pour vous connecter en toute sécurité (authjs.session-token), prévenir les attaques par falsification de requêtes intersites (CSRF) et conserver votre sélection de langue (diva_lang).\n\n• Cookies de préférences : Mémorisent vos préférences fonctionnelles (vues des tontines, état d'installation de la PWA).\n\n• Cookies de performance et de mesure d'audience : Mesures anonymes de la performance technique et du temps de chargement pour garantir une fluidité optimale lors des paiements et des tirages."
            : "• Strictly Necessary Cookies: Essential for secure login sessions (authjs.session-token), protecting against Cross-Site Request Forgery (CSRF), and retaining your language selection (diva_lang).\n\n• Preference Cookies: Store your operational settings (cotisation views, PWA installation status).\n\n• Performance & Analytics Cookies: Anonymous telemetry on system speed and transaction reliability to provide maximum platform availability."
        }
      />

      <LegalSection
        title={isFr ? "3. Durée de conservation" : "3. Retention Period"}
        body={
          isFr
            ? "Les cookies de session expirent dès la déconnexion ou la fermeture de session. Vos choix de consentement aux cookies sont conservés pendant 12 mois maximum, après quoi votre consentement vous sera de nouveau demandé."
            : "Session cookies expire when you sign out or close your session. Your cookie consent preferences are stored for a maximum of 12 months, after which you will be prompted again."
        }
      />

      <LegalSection
        title={isFr ? "4. Vos droits et contrôle" : "4. Your Rights & Control"}
        body={
          isFr
            ? "Conformément aux réglementations sur la protection de la vie privée (RGPD), vous disposez du droit d'accepter, de refuser ou de personnaliser les cookies à tout moment via le bouton ci-dessus ou les paramètres de votre navigateur."
            : "In accordance with global privacy frameworks (including GDPR), you have the right to accept, reject, or customize cookies at any time via the button above or through your browser settings."
        }
      />
    </LegalPageShell>
  );
}
