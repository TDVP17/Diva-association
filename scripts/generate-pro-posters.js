const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const sharp = require("sharp");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUTPUT_DIR = path.resolve(__dirname, "../public/posters");
const TEMP_DIR = path.resolve(__dirname, "../tmp-posters");

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Read official brand lockup as base64
const logoBase64 = fs.readFileSync(path.resolve(__dirname, "../public/icons/brand-lockup.png")).toString("base64");
const logoDataUri = `data:image/png;base64,${logoBase64}`;

const POSTER_CONFIGS = [
  {
    num: "1",
    filename: "1-lundi-diva-asso.jpg",
    day: "LUNDI",
    headline1: "BON LUNDI,",
    headline2: "BELLE SEMAINE.",
    pitch: "Le premier jour est le bon pour sécuriser votre épargne et financer vos projets. Rejoignez votre tontine en toute confiance.",
    usp1: "Cotisations 100% sécurisées via Orange & MTN Money",
    usp2: "Cagnotte reversée directement sans intermédiaire",
    deviceType: "mobile",
    screenNav: "Étape 1/3 · Tontine Digitale",
    screenTitle: "Choisissez votre opération",
    screenContent: `
      <div class="pot-banner">
        <div class="pot-banner-top">
          <span class="pot-tag">Cagnotte Globale</span>
          <span class="pot-badge">SESSION EN COURS</span>
        </div>
        <div class="pot-amount">2 500 000 <small>FCFA</small></div>
        <div class="pot-meta">
          <span>Cycle Hebdomadaire Dimanche</span>
          <span style="color:#e1cc41; font-weight:700;">28/30 Payés</span>
        </div>
      </div>

      <div class="grid-title">Services en 1 Clic</div>
      <div class="service-grid">
        <div class="service-card selected">
          <div class="service-icon">💳</div>
          <div class="service-name">Cotiser ma part</div>
          <div class="service-desc">Orange / MTN</div>
        </div>
        <div class="service-card">
          <div class="service-icon">👥</div>
          <div class="service-name">Pour un proche</div>
          <div class="service-desc">Solidarité</div>
        </div>
        <div class="service-card">
          <div class="service-icon">🎲</div>
          <div class="service-name">Tirage officiel</div>
          <div class="service-desc">Direct audité</div>
        </div>
        <div class="service-card">
          <div class="service-icon">⚡</div>
          <div class="service-name">Paiement groupé</div>
          <div class="service-desc">1 seul débit</div>
        </div>
      </div>

      <div class="slots-list">
        <div class="slot-item">
          <div>
            <div class="slot-title">Paul K. (Part N° 04)</div>
            <div class="slot-sub">Dimanche Hebdo · 50 000 FCFA</div>
          </div>
          <span class="badge-paid">COTISÉ ✓</span>
        </div>
        <div class="slot-item">
          <div>
            <div class="slot-title">Mireille N. (Part N° 07)</div>
            <div class="slot-sub">Dimanche Hebdo · 50 000 FCFA</div>
          </div>
          <span class="badge-paid">COTISÉ ✓</span>
        </div>
      </div>

      <button class="phone-cta-btn">Procéder au paiement (50 000 F) →</button>
    `
  },
  {
    num: "2",
    filename: "2-mardi-diva-asso.jpg",
    day: "MARDI",
    headline1: "MARDI AMBITION,",
    headline2: "DEVANCEZ L'AVENIR.",
    pitch: "Vos grands projets méritent une épargne solide. Suivez vos cagnottes et vos cotisations en temps réel sur grand écran.",
    usp1: "Tableau de bord financier clair et transparent",
    usp2: "Reçus nominatifs officiels téléchargeables",
    deviceType: "pc",
    pcUrl: "https://www.divaasso.com/dashboard",
    pcTitle: "Espace Membre DIVA Asso · Arnaud K.",
    pcKpi1Lbl: "Cagnotte Globale",
    pcKpi1Val: "2 500 000 FCFA",
    pcKpi2Lbl: "Votre Tirage",
    pcKpi2Val: "Position N° 05 · Dimanche",
    pcTable: `
      <div class="pc-tbl-row">
        <span>Arnaud Kouam</span>
        <span>Hebdo Dimanche</span>
        <span style="color: #15803d; font-weight:800;">COTISÉ ✓</span>
      </div>
      <div class="pc-tbl-row">
        <span>Madeleine Fotso</span>
        <span>Hebdo Dimanche</span>
        <span style="color: #15803d; font-weight:800;">COTISÉ ✓</span>
      </div>
      <div class="pc-tbl-row">
        <span>Jean-Marc T.</span>
        <span>Hebdo Dimanche</span>
        <span style="color: #15803d; font-weight:800;">COTISÉ ✓</span>
      </div>
      <div class="pc-tbl-row">
        <span>Tirage Officiel</span>
        <span>Huissier Audité</span>
        <span style="color: #0284c7; font-weight:800;">EN DIRECT</span>
      </div>
    `
  },
  {
    num: "3",
    filename: "3-mercredi-diva-asso.jpg",
    day: "MERCREDI",
    headline1: "MERCREDI CONFIANCE,",
    headline2: "TRANSPARENCE TOTALE.",
    pitch: "Zéro favoritisme, zéro doute dans l'ombre. Notre algorithme certifié tire les boules en direct sous les yeux de tous les membres.",
    usp1: "Tirage au sort public et audité en direct",
    usp2: "Chacun connaît sa position officielle sans litige",
    deviceType: "mobile",
    screenNav: "Tirage en Direct · Session Hebdo",
    screenTitle: "Tirage au sort officiel certifié",
    screenContent: `
      <div class="pot-banner" style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);">
        <div class="pot-banner-top">
          <span class="pot-tag" style="color:#38bdf8;">AUDIT OFFICIEL EN DIRECT</span>
          <span class="pot-badge" style="border-color:#38bdf8; color:#38bdf8; background:rgba(56,189,248,0.15);">100% CONFORME</span>
        </div>
        <div class="pot-amount" style="font-size: 22px;">Tirage Aléatoire Audité</div>
        <div class="pot-meta">
          <span>Session Hebdomadaire Dimanche</span>
          <span style="color:#38bdf8; font-weight:700;">30 Boules</span>
        </div>
      </div>

      <div class="grid-title">Boules Sorties au Tirage</div>
      <div style="display:flex; justify-content:space-between; align-items:center; background:#ffffff; padding:14px 10px; border-radius:14px; border:1px solid #e2e8f0; margin-bottom:12px;">
        <div style="width:42px; height:42px; border-radius:50%; background:#dcfce7; color:#15803d; font-weight:900; font-size:16px; display:flex; align-items:center; justify-content:center; border:2px solid #22c55e;">01</div>
        <div style="width:42px; height:42px; border-radius:50%; background:#dcfce7; color:#15803d; font-weight:900; font-size:16px; display:flex; align-items:center; justify-content:center; border:2px solid #22c55e;">02</div>
        <div style="width:48px; height:48px; border-radius:50%; background:#e1cc41; color:#0f172a; font-weight:900; font-size:18px; display:flex; align-items:center; justify-content:center; border:3px solid #b45309; box-shadow:0 0 12px rgba(225,204,65,0.6);">03</div>
        <div style="width:42px; height:42px; border-radius:50%; background:#f1f5f9; color:#64748b; font-weight:800; font-size:16px; display:flex; align-items:center; justify-content:center; border:1px solid #cbd5e1;">04</div>
        <div style="width:42px; height:42px; border-radius:50%; background:#f1f5f9; color:#64748b; font-weight:800; font-size:16px; display:flex; align-items:center; justify-content:center; border:1px solid #cbd5e1;">05</div>
      </div>

      <div style="background:#ffffff; border:2px solid #e1cc41; border-radius:14px; padding:12px; margin-bottom:12px; text-align:center;">
        <div style="font-size:10px; font-weight:700; color:#b45309; text-transform:uppercase;">🏆 Boule N° 03 tirée pour :</div>
        <div style="font-size:15px; font-weight:800; color:#0f172a; margin-top:2px;">Kouam Arnaud (Part N° 03)</div>
        <div style="font-size:10px; color:#15803d; font-weight:700; margin-top:3px;">Bénéficiaire confirmé de la cagnotte !</div>
      </div>

      <div class="slots-list">
        <div class="slot-item">
          <div><span class="slot-title">Tour 1 : 08 Nov</span> <span class="slot-sub">· Mme Fotso C.</span></div>
          <span class="badge-paid">REVERSÉ ✓</span>
        </div>
        <div class="slot-item">
          <div><span class="slot-title">Tour 2 : 15 Nov</span> <span class="slot-sub">· M. Jean-Marc</span></div>
          <span class="badge-paid">REVERSÉ ✓</span>
        </div>
      </div>
    `
  },
  {
    num: "4",
    filename: "4-jeudi-diva-asso.jpg",
    day: "JEUDI",
    headline1: "JEUDI SOLIDARITÉ,",
    headline2: "SOUTENEZ VOS PROCHES.",
    pitch: "Que vous soyez sur place ou dans la diaspora, aidez vos parents ou amis. Entrez simplement leur matricule et cotisez pour eux en 1 clic.",
    usp1: "Accessible partout dans le monde en ligne",
    usp2: "Reçu certifié envoyé instantanément à votre proche",
    deviceType: "pc",
    pcUrl: "https://www.divaasso.com/contribute-for-relative",
    pcTitle: "Contribuer pour un Proche · Solidarité",
    pcKpi1Lbl: "Matricule Recherché",
    pcKpi1Val: "DIVA-8942-CMR ✓",
    pcKpi2Lbl: "Bénéficiaire Identifié",
    pcKpi2Val: "Maman Madeleine (Mère)",
    pcTable: `
      <div class="pc-tbl-row">
        <span>Part N° 01 : Hebdo Dimanche</span>
        <span>50 000 FCFA</span>
        <span style="color: #15803d; font-weight:800;">VALIDÉ ✓</span>
      </div>
      <div class="pc-tbl-row">
        <span>Part N° 02 : Hebdo Dimanche</span>
        <span>50 000 FCFA</span>
        <span style="color: #15803d; font-weight:800;">VALIDÉ ✓</span>
      </div>
      <div class="pc-tbl-row">
        <span>Mode de Paiement</span>
        <span>Orange / MTN</span>
        <span style="color: #0284c7; font-weight:800;">SÉCURISÉ</span>
      </div>
      <div class="pc-tbl-row">
        <span>Reçu Nominatif Officiel</span>
        <span>WhatsApp / Email</span>
        <span style="color: #15803d; font-weight:800;">TRANSMIS ✓</span>
      </div>
    `
  },
  {
    num: "5",
    filename: "5-vendredi-diva-asso.jpg",
    day: "VENDREDI",
    headline1: "VENDREDI MALIN,",
    headline2: "SIMPLIFIEZ TOUT.",
    pitch: "Vous avez plusieurs parts dans la tontine ? Cochez tous vos créneaux et réglez en un seul débit sans multiplier les frais de transfert.",
    usp1: "1 seule validation USSD au lieu de débits répétés",
    usp2: "Économisez sur les frais Orange & MTN Money",
    deviceType: "mobile",
    screenNav: "Paiement Groupé · Session Hebdo",
    screenTitle: "Réglez plusieurs créneaux en 1 clic",
    screenContent: `
      <div class="pot-banner" style="background: linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%);">
        <div class="pot-banner-top">
          <span class="pot-tag" style="color:#60a5fa;">PAIEMENT GLOBAL MULTI-PARTS</span>
          <span class="pot-badge" style="border-color:#60a5fa; color:#60a5fa; background:rgba(96,165,250,0.15);">ÉCONOMIE FRAIS</span>
        </div>
        <div class="pot-amount">150 000 <small>FCFA</small></div>
        <div class="pot-meta">
          <span>3 créneaux sélectionnés</span>
          <span style="color:#60a5fa; font-weight:700;">1 seul débit USSD</span>
        </div>
      </div>

      <div class="grid-title">Vos créneaux cochés</div>
      <div class="slots-list" style="margin-bottom:12px;">
        <div class="slot-item">
          <div><span class="slot-title">Part N° 01 : Jean-Marc (Hebdo)</span> <div class="slot-sub">Montant de la part : 50 000 FCFA</div></div>
          <span style="color:#15803d; font-weight:900; font-size:13px;">☑</span>
        </div>
        <div class="slot-item">
          <div><span class="slot-title">Part N° 02 : Jean-Marc Jr (Hebdo)</span> <div class="slot-sub">Montant de la part : 50 000 FCFA</div></div>
          <span style="color:#15803d; font-weight:900; font-size:13px;">☑</span>
        </div>
        <div class="slot-item">
          <div><span class="slot-title">Part N° 03 : Commerce (Hebdo)</span> <div class="slot-sub">Montant de la part : 50 000 FCFA</div></div>
          <span style="color:#15803d; font-weight:900; font-size:13px;">☑</span>
        </div>
      </div>

      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; padding:10px; font-size:10px; color:#1e40af; font-weight:600; text-align:center; margin-bottom:12px;">
        ⚡ Un seul prélèvement sur votre compte Orange Money ou MTN MoMo
      </div>

      <button class="phone-cta-btn" style="background:#1d4ed8;">Valider le paiement groupé (150 000 F) →</button>
    `
  },
  {
    num: "6",
    filename: "6-samedi-diva-asso.jpg",
    day: "SAMEDI",
    headline1: "BON SAMEDI,",
    headline2: "SOYEZ PRÊTS DEMAIN.",
    pitch: "Demain dimanche, la tontine s'ouvre ! Approvisionnez votre compte Mobile Money dès aujourd'hui pour cotiser l'esprit tranquille.",
    usp1: "Rappels automatiques WhatsApp & SMS sans stress",
    usp2: "Zéro amende de retard, zéro pénalité",
    deviceType: "mobile",
    screenNav: "Veille de Session · Alertes Actives",
    screenTitle: "Vérification de votre compte",
    screenContent: `
      <div style="background:#ffffff; border-radius:16px; padding:14px; border:2px solid #f59e0b; box-shadow:0 6px 18px rgba(245,158,11,0.15); margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span style="font-size:22px;">🔔</span>
          <div>
            <div style="font-size:13px; font-weight:800; color:#0f172a;">Rappel Officiel DIVA Asso</div>
            <div style="font-size:10px; color:#64748b;">Ouverture demain dès 08h00</div>
          </div>
        </div>
        <div style="font-size:11px; color:#334155; line-height:1.4;">
          La session <strong>Hebdo Sunday</strong> s'ouvre demain matin. Vérifiez votre solde Orange Money ou MTN MoMo dès ce soir pour un versement fluide sans retard !
        </div>
      </div>

      <div class="grid-title">Guide Sérénité du Dimanche</div>
      <div class="slots-list" style="margin-bottom:12px;">
        <div class="slot-item">
          <div><span class="slot-title">Compte Mobile Money rechargé</span> <div class="slot-sub">Montant de votre part disponible</div></div>
          <span class="badge-paid">PRÊT ✓</span>
        </div>
        <div class="slot-item">
          <div><span class="slot-title">Heure limite de versement</span> <div class="slot-sub">Avant 18h30 pour zéro amende</div></div>
          <span style="color:#0284c7; font-weight:800; font-size:9px;">18H30 MAX</span>
        </div>
        <div class="slot-item">
          <div><span class="slot-title">Reçu certifié automatique</span> <div class="slot-sub">Généré dès validation du paiement</div></div>
          <span class="badge-paid">GARANTI ✓</span>
        </div>
      </div>

      <div style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:12px; padding:10px; text-align:center;">
        <span style="font-size:12px; font-weight:800; color:#15803d;">✓ Mon Statut : Prêt pour la cotisation</span>
      </div>
    `
  },
  {
    num: "7",
    filename: "7-dimanche-diva-asso.jpg",
    day: "DIMANCHE",
    headline1: "DIMANCHE GAGNANT,",
    headline2: "LA CAGNOTTE EST LÀ !",
    pitch: "C'est le grand jour ! 100% des membres ont cotisé, les fonds sont sécurisés et reversés directement sur le compte Mobile Money du bénéficiaire.",
    usp1: "Reversement 100% intégral le jour même",
    usp2: "Aucune attente, transfert Orange & MTN direct",
    deviceType: "mobile",
    screenNav: "Session Hebdomadaire · Succès Total",
    screenTitle: "100% des cotisations collectées",
    screenContent: `
      <div class="pot-banner" style="background: linear-gradient(135deg, #15803d 0%, #064e3b 100%);">
        <div class="pot-banner-top">
          <span class="pot-tag" style="color:#fef08a;">100% COTISATIONS COLLECTÉES</span>
          <span class="pot-badge" style="border-color:#fef08a; color:#fef08a; background:rgba(254,240,138,0.2);">SUCCÈS TOTAL</span>
        </div>
        <div class="pot-amount">2 500 000 <small>FCFA</small></div>
        <div class="pot-meta">
          <span>30/30 membres à jour</span>
          <span style="color:#fef08a; font-weight:800;">Fonds débloqués 🏆</span>
        </div>
      </div>

      <div style="background:#ffffff; border-radius:16px; padding:14px; border:2px solid #22c55e; margin-bottom:12px; text-align:center;">
        <div style="font-size:24px; margin-bottom:4px;">🏆</div>
        <div style="font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase;">Bénéficiaire de la cagnotte du jour</div>
        <div style="font-size:17px; font-weight:900; color:#0f172a; margin-top:2px;">Kouam Arnaud</div>
        <div style="font-size:12px; font-weight:800; color:#15803d; margin-top:4px;">Reversé sur Orange Money (699 •• •• 12) ✓</div>
      </div>

      <div class="slots-list" style="margin-bottom:10px;">
        <div class="slot-item">
          <div><span class="slot-title">Statut de la session</span> <div class="slot-sub">Tous les reçus transmis</div></div>
          <span class="badge-paid">CLÔTURÉE ✓</span>
        </div>
        <div class="slot-item">
          <div><span class="slot-title">Prochain tour de tontine</span> <div class="slot-sub">Dimanche prochain dès 08h00</div></div>
          <span style="color:#0284c7; font-weight:800; font-size:9px;">TOUR SUIVANT</span>
        </div>
      </div>

      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:8px; text-align:center; font-size:10px; color:#475569; font-weight:700;">
        Félicitations à toute la communauté DIVA Asso ! 🎉
      </div>
    `
  },
  {
    num: "8",
    filename: "8-comment-ca-marche-diva-asso.jpg",
    day: "GUIDE",
    headline1: "COMMENT ÇA MARCHE ?",
    headline2: "SIMPLE, SÛR & EN LIGNE.",
    pitch: "Découvrez la tontine rotative moderne : une méthode simple, transparente et automatisée pour concrétiser vos projets en toute sécurité.",
    usp1: "4 étapes claires de l'inscription au gain",
    usp2: "Plateforme accessible sur Web, Mobile et PC",
    deviceType: "pc",
    pcUrl: "https://www.divaasso.com/comment-ca-marche",
    pcTitle: "Guide Officiel : Comment Fonctionne DIVA Asso",
    pcKpi1Lbl: "Sécurité & Transparence",
    pcKpi1Val: "100% Automatisé",
    pcKpi2Lbl: "Paiement Mobile",
    pcKpi2Val: "Orange & MTN Money",
    pcTable: `
      <div class="pc-tbl-row">
        <span>1. Inscription gratuite & vérification KYC</span>
        <span>2 minutes</span>
        <span style="color: #15803d; font-weight:800;">ÉTAPE 1</span>
      </div>
      <div class="pc-tbl-row">
        <span>2. Adhésion au groupe & tirage transparent</span>
        <span>Public & Audité</span>
        <span style="color: #15803d; font-weight:800;">ÉTAPE 2</span>
      </div>
      <div class="pc-tbl-row">
        <span>3. Cotisation en 1 clic Orange ou MTN</span>
        <span>Reçu instantané</span>
        <span style="color: #15803d; font-weight:800;">ÉTAPE 3</span>
      </div>
      <div class="pc-tbl-row">
        <span>4. Réception directe de votre cagnotte</span>
        <span>100% Reversée</span>
        <span style="color: #0284c7; font-weight:800;">ÉTAPE 4 🏆</span>
      </div>
    `
  }
];

function buildPosterHtml(config) {
  const isPc = config.deviceType === "pc";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,700;0,800;0,900;1,900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1080px;
    height: 1080px;
    overflow: hidden;
    background-color: #1a3e35;
    background-image: 
      radial-gradient(circle at 82% 55%, rgba(36, 110, 90, 0.45) 0%, transparent 55%),
      radial-gradient(circle at 18% 25%, rgba(14, 45, 36, 0.8) 0%, transparent 65%);
    font-family: 'Plus Jakarta Sans', sans-serif;
    color: #ffffff;
    position: relative;
  }

  .bg-glow-1 {
    position: absolute;
    top: -100px;
    right: -100px;
    width: 450px;
    height: 450px;
    background: radial-gradient(circle, rgba(225, 204, 65, 0.08) 0%, transparent 70%);
    pointer-events: none;
  }

  /* TOP LEFT LOGO */
  .brand-header {
    position: absolute;
    top: 65px;
    left: 80px;
    z-index: 10;
  }
  .brand-logo {
    height: 78px;
    width: auto;
    object-fit: contain;
    filter: drop-shadow(0 6px 16px rgba(0,0,0,0.35));
  }

  /* LEFT MARKETING CONTENT */
  .left-content {
    position: absolute;
    top: 220px;
    left: 80px;
    width: ${isPc ? '430px' : '490px'};
    z-index: 10;
    display: flex;
    flex-direction: column;
  }

  .main-headline {
    font-family: 'Montserrat', sans-serif;
    font-size: ${isPc ? '43px' : '52px'};
    font-weight: 900;
    line-height: 1.05;
    letter-spacing: -0.025em;
    text-transform: uppercase;
    margin-bottom: 22px;
  }
  .headline-white {
    color: #ffffff;
    display: block;
    text-shadow: 0 4px 14px rgba(0,0,0,0.4);
  }
  .headline-yellow {
    color: #e1cc41;
    display: block;
    position: relative;
    text-shadow: 0 4px 0 #b91c1c, 0 6px 18px rgba(0,0,0,0.35);
  }

  .sub-pitch {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 20px;
    font-weight: 500;
    line-height: 1.45;
    color: #e2e8f0;
    margin-bottom: 22px;
  }

  .usp-points {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 28px;
  }
  .usp-item {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 700;
    color: #f8fafc;
  }
  .usp-dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(225, 204, 65, 0.2);
    border: 1.5px solid #e1cc41;
    color: #e1cc41;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 900;
    flex-shrink: 0;
  }

  /* BOTTOM CONTACT & BADGES */
  .footer-block {
    position: absolute;
    bottom: 60px;
    left: 80px;
    width: 490px;
    z-index: 10;
  }
  .website-url {
    font-family: 'Montserrat', sans-serif;
    font-size: 28px;
    font-weight: 900;
    color: #e1cc41;
    letter-spacing: -0.01em;
    margin-bottom: 4px;
    text-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .social-meta {
    font-size: 16px;
    font-weight: 600;
    color: #94a3b8;
    margin-bottom: 18px;
  }

  .badges-grid {
    display: grid;
    grid-template-columns: 195px 195px;
    gap: 10px;
  }
  .store-badge {
    height: 44px;
    background: #090d16;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 10px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    color: #ffffff;
    box-shadow: 0 6px 14px rgba(0,0,0,0.4);
  }
  .store-badge svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
    flex-shrink: 0;
  }
  .store-badge-text {
    display: flex;
    flex-direction: column;
    text-align: left;
  }
  .store-badge-sub {
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #94a3b8;
    line-height: 1;
  }
  .store-badge-title {
    font-size: 13px;
    font-weight: 700;
    line-height: 1.15;
    font-family: 'Plus Jakarta Sans', sans-serif;
  }

  .payment-pill {
    height: 44px;
    background: #090d16;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 10px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    font-weight: 700;
    color: #f3f4f6;
    box-shadow: 0 6px 14px rgba(0,0,0,0.4);
  }
  .dot-orange { width: 14px; height: 14px; border-radius: 50%; background: #ff7900; box-shadow: 0 0 8px #ff7900; flex-shrink: 0; }
  .dot-yellow { width: 14px; height: 14px; border-radius: 50%; background: #ffcc00; box-shadow: 0 0 8px #ffcc00; flex-shrink: 0; }

  /* RIGHT SIDE DEVICE CONTAINER */
  .device-container {
    position: absolute;
    right: 40px;
    bottom: -35px;
    z-index: 5;
  }

  /* SMARTPHONE MOCKUP */
  .phone-mockup {
    width: 450px;
    height: 900px;
    background: #0b1120;
    border-radius: 54px;
    padding: 13px;
    box-shadow: 
      0 35px 90px rgba(0, 0, 0, 0.8),
      0 0 0 3px rgba(255, 255, 255, 0.16),
      inset 0 0 0 3px #1e293b;
    position: relative;
    overflow: hidden;
  }
  .phone-screen {
    width: 100%;
    height: 100%;
    background: #f8fafc;
    border-radius: 44px;
    overflow: hidden;
    position: relative;
    color: #0f172a;
    display: flex;
    flex-direction: column;
  }
  .phone-status-bar {
    height: 44px;
    padding: 0 26px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
    background: #f8fafc;
    z-index: 20;
  }
  .dynamic-island {
    position: absolute;
    top: 11px;
    left: 50%;
    transform: translateX(-50%);
    width: 116px;
    height: 28px;
    background: #000000;
    border-radius: 20px;
    z-index: 30;
  }

  .screen-header-nav {
    padding: 6px 20px 14px 20px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }
  .nav-step {
    font-size: 11px;
    font-weight: 700;
    color: #0d5f47;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 3px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .nav-title {
    font-size: 18px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.2;
  }

  .phone-body {
    padding: 14px 18px;
    flex: 1;
    overflow: hidden;
    background: #f1f5f9;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .pot-banner {
    background: linear-gradient(135deg, #0d3b2e 0%, #06231c 100%);
    border-radius: 18px;
    padding: 16px 18px;
    color: #ffffff;
    box-shadow: 0 8px 24px rgba(13, 59, 46, 0.4);
    position: relative;
    overflow: hidden;
  }
  .pot-banner::after {
    content: '';
    position: absolute;
    right: -25px;
    bottom: -25px;
    width: 100px;
    height: 100px;
    background: radial-gradient(circle, rgba(225, 204, 65, 0.3) 0%, transparent 70%);
  }
  .pot-banner-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }
  .pot-tag {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #e1cc41;
  }
  .pot-badge {
    background: rgba(34, 197, 94, 0.2);
    border: 1px solid #22c55e;
    color: #4ade80;
    font-size: 9px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 12px;
  }
  .pot-amount {
    font-family: 'Montserrat', sans-serif;
    font-size: 26px;
    font-weight: 900;
    color: #ffffff;
    line-height: 1.1;
  }
  .pot-amount small { font-size: 13px; font-weight: 700; color: #e1cc41; }
  .pot-meta {
    font-size: 11px;
    color: #94a3b8;
    margin-top: 6px;
    display: flex;
    justify-content: space-between;
  }

  .grid-title {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #475569;
  }
  .service-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .service-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.03);
    position: relative;
  }
  .service-card.selected {
    border: 2.5px solid #0d5f47;
    background: #f0fdf4;
    box-shadow: 0 4px 14px rgba(13, 95, 71, 0.18);
  }
  .service-card.selected::before {
    content: '✓';
    position: absolute;
    top: 6px;
    right: 8px;
    width: 16px;
    height: 16px;
    background: #0d5f47;
    color: #ffffff;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .service-icon {
    font-size: 26px;
    margin-bottom: 4px;
  }
  .service-name {
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.2;
    margin-bottom: 2px;
  }
  .service-desc {
    font-size: 9px;
    color: #64748b;
  }

  .slots-list {
    background: #ffffff;
    border-radius: 14px;
    padding: 10px 14px;
    border: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .slot-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
  }
  .slot-title { font-weight: 700; color: #1e293b; }
  .slot-sub { font-size: 9px; color: #64748b; }
  .badge-paid {
    background: #dcfce7;
    color: #15803d;
    font-size: 9px;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 6px;
  }

  .phone-cta-btn {
    background: #0d5f47;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    padding: 11px 16px;
    border-radius: 12px;
    text-align: center;
    border: none;
    box-shadow: 0 4px 12px rgba(13, 95, 71, 0.35);
  }

  .floating-bottom-nav {
    height: 54px;
    background: #ffffff;
    border-top: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 0 10px;
  }
  .nav-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: 9px;
    font-weight: 700;
    color: #94a3b8;
  }
  .nav-btn.active {
    color: #0d5f47;
  }
  .nav-btn svg {
    width: 19px;
    height: 19px;
    fill: currentColor;
    margin-bottom: 2px;
  }

  /* PC LAPTOP MOCKUP */
  .pc-container {
    position: absolute;
    right: -40px;
    top: 200px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .laptop-mockup {
    width: 560px;
    position: relative;
  }
  .laptop-screen {
    width: 560px;
    height: 360px;
    background: #0f172a;
    border-radius: 18px 18px 4px 4px;
    border: 11px solid #1e293b;
    border-bottom: 13px solid #1e293b;
    box-shadow: 
      0 35px 90px rgba(0, 0, 0, 0.8),
      0 0 0 1px rgba(255, 255, 255, 0.12);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: #f8fafc;
    color: #0f172a;
  }
  .laptop-base {
    width: 630px;
    height: 18px;
    background: linear-gradient(180deg, #94a3b8 0%, #475569 100%);
    border-radius: 0 0 18px 18px;
    margin-top: -1px;
    position: relative;
    box-shadow: 0 18px 40px rgba(0,0,0,0.6);
  }
  .laptop-notch {
    width: 90px;
    height: 6px;
    background: #334155;
    border-radius: 0 0 6px 6px;
    margin: 0 auto;
  }

  .mac-top-bar {
    height: 32px;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    padding: 0 14px;
    gap: 14px;
  }
  .mac-dots {
    display: flex;
    gap: 6px;
  }
  .mac-dot { width: 9px; height: 9px; border-radius: 50%; }
  .dot-r { background: #ef4444; }
  .dot-y { background: #eab308; }
  .dot-g { background: #22c55e; }
  .mac-url {
    background: #f1f5f9;
    border-radius: 6px;
    padding: 3px 14px;
    font-size: 11px;
    color: #475569;
    font-weight: 600;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mac-inner-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  .mac-sidebar {
    width: 140px;
    background: #0d2b24;
    color: #ffffff;
    padding: 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sidebar-logo {
    font-size: 13px;
    font-weight: 800;
    color: #e1cc41;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .side-item {
    font-size: 10px;
    padding: 6px 8px;
    border-radius: 6px;
    color: #cbd5e1;
    font-weight: 600;
  }
  .side-item.active {
    background: rgba(225, 204, 65, 0.2);
    color: #e1cc41;
  }
  .mac-content {
    flex: 1;
    padding: 14px 16px;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .pc-dash-title {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .pc-kyc-pill {
    background: #dcfce7;
    color: #15803d;
    font-size: 9px;
    font-weight: 800;
    padding: 3px 8px;
    border-radius: 6px;
  }
  .pc-kpis {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .pc-kpi-box {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 10px 12px;
  }
  .pc-kpi-box.highlight {
    background: #f0fdf4;
    border-color: #86efac;
  }
  .pc-kpi-lbl { font-size: 9px; color: #64748b; font-weight: 700; text-transform: uppercase; margin-bottom: 2px; }
  .pc-kpi-num { font-size: 16px; font-weight: 800; color: #0f172a; }
  .pc-kpi-box.highlight .pc-kpi-num { color: #15803d; }
  .pc-table-wrap {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 10px 12px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pc-tbl-header {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    border-bottom: 1px solid #f1f5f9;
    padding-bottom: 6px;
  }
  .pc-tbl-row {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    font-weight: 600;
    color: #1e293b;
    padding: 4px 0;
  }

  .floating-pc-pill {
    margin-top: 20px;
    background: rgba(13, 43, 36, 0.85);
    border: 1px solid rgba(225, 204, 65, 0.4);
    border-radius: 30px;
    padding: 8px 18px;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.4);
  }
</style>
</head>
<body>

  <div class="bg-glow-1"></div>

  <!-- BRAND HEADER -->
  <div class="brand-header">
    <img src="${logoDataUri}" alt="DIVA Asso" class="brand-logo" />
  </div>

  <!-- LEFT MARKETING COPY -->
  <div class="left-content">
    <div class="main-headline">
      <span class="headline-white">${config.headline1}</span>
      <span class="headline-yellow">${config.headline2}</span>
    </div>
    <div class="sub-pitch">
      ${config.pitch}
    </div>
    <div class="usp-points">
      <div class="usp-item">
        <span class="usp-dot">✓</span>
        <span>${config.usp1}</span>
      </div>
      <div class="usp-item">
        <span class="usp-dot">✓</span>
        <span>${config.usp2}</span>
      </div>
    </div>
  </div>

  <!-- BOTTOM FOOTER -->
  <div class="footer-block">
    <div class="website-url">divaasso.com</div>
    <div class="social-meta">@divaasso · contact@divaasso.com</div>
    <div class="badges-grid">
      <div class="store-badge">
        <svg viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.61-.75 1.04-1.8 0.92-2.85-.9.04-2 .6-2.65 1.35-.56.64-1.06 1.71-0.92 2.73 1.01.08 2.04-.48 2.65-1.23z"/></svg>
        <div class="store-badge-text">
          <span class="store-badge-sub">Télécharger sur</span>
          <span class="store-badge-title">App Store</span>
        </div>
      </div>
      <div class="store-badge">
        <svg viewBox="0 0 24 24"><path d="M3.609 1.814L13.792 12 3.61 22.186a2.03 2.03 0 0 1-.61-1.464V3.278c0-.572.227-1.1.609-1.464zm11.597 11.598L17.7 15.9l-11.83 6.83 9.336-9.318zm0-2.824L5.87 1.27 17.7 8.1 15.206 10.588zm1.414 1.412l2.843-1.642a1.74 1.74 0 0 1 1.74 0l.006.003-4.589 4.589v-2.95z"/></svg>
        <div class="store-badge-text">
          <span class="store-badge-sub">DISPONIBLE SUR</span>
          <span class="store-badge-title">Google Play</span>
        </div>
      </div>
      <div class="payment-pill">
        <span class="dot-orange"></span> Orange Money
      </div>
      <div class="payment-pill">
        <span class="dot-yellow"></span> MTN MoMo
      </div>
    </div>
  </div>

  <!-- RIGHT DEVICE -->
  ${isPc ? `
    <div class="pc-container">
      <div class="laptop-mockup">
        <div class="laptop-screen">
          <div class="mac-top-bar">
            <div class="mac-dots"><span class="mac-dot dot-r"></span><span class="mac-dot dot-y"></span><span class="mac-dot dot-g"></span></div>
            <div class="mac-url">🔒 ${config.pcUrl || 'https://www.divaasso.com/dashboard'}</div>
          </div>
          <div class="mac-inner-body">
            <div class="mac-sidebar">
              <div class="sidebar-logo">DIVA Asso.</div>
              <div class="side-item active">Tableau de bord</div>
              <div class="side-item">Mes Tontines</div>
              <div class="side-item">Tirage en Direct</div>
              <div class="side-item">Mes Cotisations</div>
              <div class="side-item">Reçus Certifiés</div>
            </div>
            <div class="mac-content">
              <div class="pc-dash-title">
                <span>${config.pcTitle || "Espace Membre DIVA Asso"}</span>
                <span class="pc-kyc-pill">MEMBRE VÉRIFIÉ KYC ✓</span>
              </div>
              <div class="pc-kpis">
                <div class="pc-kpi-box">
                  <div class="pc-kpi-lbl">${config.pcKpi1Lbl || "Cagnotte Globale"}</div>
                  <div class="pc-kpi-num">${config.pcKpi1Val || "2 500 000 FCFA"}</div>
                </div>
                <div class="pc-kpi-box highlight">
                  <div class="pc-kpi-lbl">${config.pcKpi2Lbl || "Votre Tirage"}</div>
                  <div class="pc-kpi-num">${config.pcKpi2Val || "Position N° 05"}</div>
                </div>
              </div>
              <div class="pc-table-wrap">
                <div class="pc-tbl-header">
                  <span>Participant / Détail</span>
                  <span>Session / Réf</span>
                  <span>Statut</span>
                </div>
                ${config.pcTable}
              </div>
            </div>
          </div>
        </div>
        <div class="laptop-base"><div class="laptop-notch"></div></div>
      </div>
      <div class="floating-pc-pill">
        <span>🔒 Fonds sécurisés par séquestre bancaire</span>
        <span style="color:#e1cc41;">· Reçus certifiés</span>
      </div>
    </div>
  ` : `
    <div class="device-container">
      <div class="phone-mockup">
        <div class="dynamic-island"></div>
        <div class="phone-screen">
          <div class="phone-status-bar">
            <span>00:17</span>
            <span>5G &nbsp; 100%</span>
          </div>
          <div class="screen-header-nav">
            <div class="nav-step">${config.screenNav}</div>
            <div class="nav-title">${config.screenTitle}</div>
          </div>
          <div class="phone-body">
            ${config.screenContent}
          </div>

          <div class="floating-bottom-nav">
            <div class="nav-btn active">
              <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
              <span>Accueil</span>
            </div>
            <div class="nav-btn">
              <svg viewBox="0 0 24 24"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
              <span>Cotiser</span>
            </div>
            <div class="nav-btn">
              <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
              <span>Tontine</span>
            </div>
            <div class="nav-btn">
              <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
              <span>Profil</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `}

</body>
</html>`;
}

async function run() {
  console.log("Generating 8 professional marketing posters in HD (1080x1080)...");

  for (let i = 0; i < POSTER_CONFIGS.length; i++) {
    const config = POSTER_CONFIGS[i];
    const htmlFileName = `poster-${config.num}.html`;
    const pngFileName = `poster-${config.num}.png`;
    const jpgFileName = config.filename;

    const htmlPath = path.join(TEMP_DIR, htmlFileName);
    const pngPath = path.join(TEMP_DIR, pngFileName);
    const finalJpgPath = path.join(OUTPUT_DIR, jpgFileName);

    const htmlContent = buildPosterHtml(config);
    fs.writeFileSync(htmlPath, htmlContent, "utf-8");

    console.log(`[${i + 1}/8] Rendering ${config.day} (${config.deviceType.toUpperCase()})...`);

    execFileSync(CHROME_PATH, [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1080,1080",
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`
    ]);

    await sharp(pngPath)
      .jpeg({ quality: 96, chromaSubsampling: "4:4:4" })
      .toFile(finalJpgPath);

    console.log(`✓ Saved ${jpgFileName}`);
  }

  console.log("\nAll 8 posters generated successfully in public/posters!");
}

run().catch(err => {
  console.error("Error generating posters:", err);
  process.exit(1);
});
