// Règles du jeu dont la valeur exacte est incertaine : paramètres, avec la valeur par défaut issue
// des sources. Les tests de calibration en jeu (tests/calibration.test.ts) servent à les trancher.

export interface Rules {
  /** Plafonds des PA / PM / PO apportés par le personnage et l'équipement. */
  capPA: number;
  capPM: number;
  capPO: number;
  /** Plafond des % de résistance par élément. */
  resCap: number;
  /** Points de caractéristique gagnés par niveau (à partir du niveau 2). */
  pointsPerLevel: number;
  /**
   * Comptage du critère « Bonus de panoplies » (trophées) :
   * - "piecesMinusOne" : Σ (pièces équipées − 1) sur les panoplies d'au moins 2 pièces
   *   (une panoplie 2 pièces = 1 bonus, 3 pièces = 2 bonus…) ;
   * - "sets" : nombre de panoplies d'au moins 2 pièces.
   */
  setBonusCount: "piecesMinusOne" | "sets";
  /** Les soins profitent-ils de la Puissance ? */
  healUsesPower: boolean;
}

export const DEFAULT_RULES: Rules = {
  capPA: 12,
  capPM: 6,
  capPO: 6,
  resCap: 50,
  pointsPerLevel: 5,
  setBonusCount: "piecesMinusOne",
  healUsesPower: false,
};

export const basePA = (level: number) => (level >= 100 ? 7 : 6);
export const BASE_PM = 3;
export const BASE_INVO = 1;
export const BASE_PROSPE = 100;
export const BASE_PODS = 1000;
/** PV sans Vitalité : 55 au niveau 1, +5 par niveau. */
export const baseHP = (level: number) => 50 + 5 * level;
export const statPointsAt = (level: number, rules: Rules) => rules.pointsPerLevel * (level - 1);
