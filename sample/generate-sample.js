// Regenerates the fictitious sample files: node sample/generate-sample.js
'use strict';
const path = require('path');
const XLSX = require('../vendor/xlsx-js-style/xlsx.min.js');

const questionnaire = [
  ['Évaluation de maturité SSI — Société Exemple (données fictives)'],
  [],
  ['Réf.', 'Domaine', 'Exigence', 'Niveau de maturité', 'Commentaires interviewé', 'Recommandation', 'Criticité'],
  ['GOV-01', 'Gouvernance', 'Une politique de sécurité des systèmes d\'information (PSSI) est formalisée, validée par la direction et diffusée.', '', 'La PSSI existe mais date de 2017, elle n\'a jamais été revue. Pas de diffusion formelle aux collaborateurs.', 'Mettre à jour la PSSI, la faire valider par la direction et organiser sa diffusion.', 'Haute'],
  ['GOV-02', 'Gouvernance', 'Les rôles et responsabilités en matière de sécurité sont définis (RSSI, correspondants).', '2', 'Un RSSI à temps partiel a été nommé. Les correspondants sécurité métiers ne sont pas désignés.', '', 'Moyenne'],
  ['RH-01', 'Ressources humaines', 'Les collaborateurs sont sensibilisés régulièrement à la sécurité de l\'information.', '', 'Aucune campagne de sensibilisation. Quelques mails ponctuels envoyés par la DSI au cas par cas.', '', 'Haute'],
  ['ACC-01', 'Contrôle d\'accès', 'L\'authentification multifacteur est mise en œuvre pour les accès distants et les comptes à privilèges.', '', 'MFA déployé sur le VPN. Partiellement en place pour les administrateurs, en cours sur la messagerie.', '', 'Critique'],
  ['ACC-02', 'Contrôle d\'accès', 'Une revue des droits d\'accès est réalisée au moins annuellement.', 'Non', 'Pas de revue des habilitations. Les départs sont gérés manuellement par les RH par mail.', 'Mettre en place une revue annuelle des habilitations pilotée par les managers.', 'Haute'],
  ['ACC-03', 'Contrôle d\'accès', 'Les comptes à privilèges sont inventoriés et leur usage est tracé.', '', 'Inventaire non formalisé, dépend des personnes. Mot de passe admin partagé (contact : admin@exemple.local).', '', 'Critique'],
  ['OPS-01', 'Sécurité des opérations', 'Les correctifs de sécurité sont appliqués selon un processus défini.', '3', 'Procédure de patch management documentée et appliquée sur les postes via WSUS. Serveurs traités au cas par cas.', '', 'Haute'],
  ['OPS-02', 'Sécurité des opérations', 'Les sauvegardes sont réalisées, protégées et testées régulièrement.', '', 'Sauvegardes quotidiennes automatisées. Tests de restauration réalisés chaque trimestre avec indicateurs de suivi.', '', 'Critique'],
  ['OPS-03', 'Sécurité des opérations', 'Les journaux d\'événements de sécurité sont centralisés et analysés.', '', 'Les logs restent sur chaque serveur, pas de centralisation. Projet SIEM prévu en 2026.', '', 'Haute'],
  ['NET-01', 'Sécurité réseau', 'Le réseau est cloisonné en zones de sécurité selon la sensibilité.', '1/5', 'Réseau à plat, quelques VLAN pour la téléphonie seulement (serveur 10.0.0.12).', '', 'Haute'],
  ['INC-01', 'Gestion des incidents', 'Un processus de gestion des incidents de sécurité est défini et testé.', '', 'Process informel, l\'équipe infra réagit au cas par cas. Aucun exercice de crise réalisé.', '', 'Haute'],
  ['CONT-01', 'Continuité', 'Un plan de continuité d\'activité couvrant le SI est défini et testé.', 'Partiel', 'PCA en cours de rédaction, pas encore testé.', '', 'Moyenne'],
  ['FOU-01', 'Relations fournisseurs', 'Des clauses de sécurité sont intégrées aux contrats avec les prestataires.', 'N/A', 'Pas de prestataire IT critique à ce jour.', '', 'Faible'],
  ['ACT-01', 'Gestion des actifs', 'Un inventaire des actifs informationnels est tenu à jour.', '', 'Inventaire du parc via GLPI, mis à jour automatiquement. Revue annuelle par la DSI.', '', 'Moyenne']
];

const referential = [
  ['ID', 'Domaine', 'Mesure', 'Description'],
  ['M-GOV-1', 'Gouvernance', 'Désigner les correspondants sécurité', 'Nommer formellement un correspondant sécurité par direction métier, avec une lettre de mission précisant ses responsabilités et le lien avec le RSSI.'],
  ['M-GOV-2', 'Gouvernance', 'Formaliser une politique de sécurité', 'Rédiger une politique de sécurité du SI, la faire approuver par la direction, la publier et la réviser au moins tous les deux ans.'],
  ['M-RH-1', 'Ressources humaines', 'Programme de sensibilisation', 'Déployer un programme annuel de sensibilisation à la sécurité (e-learning, campagnes d\'hameçonnage simulé, communication) et suivre le taux de participation des collaborateurs.'],
  ['M-ACC-1', 'Contrôle d\'accès', 'Authentification multifacteur', 'Généraliser l\'authentification multifacteur pour les accès distants, la messagerie et l\'ensemble des comptes à privilèges.'],
  ['M-ACC-2', 'Contrôle d\'accès', 'Gestion des comptes à privilèges', 'Inventorier les comptes à privilèges, supprimer les comptes partagés, déployer une solution de gestion des accès à privilèges (bastion / PAM) et tracer les sessions.'],
  ['M-ACC-3', 'Contrôle d\'accès', 'Revue des habilitations', 'Organiser une revue périodique des droits d\'accès par les responsables métiers et automatiser la désactivation des comptes lors des départs.'],
  ['M-OPS-1', 'Sécurité des opérations', 'Centralisation des journaux', 'Centraliser les journaux d\'événements de sécurité dans un puits de logs ou un SIEM, définir des règles de détection et une conservation adaptée.'],
  ['M-OPS-2', 'Sécurité des opérations', 'Gestion des correctifs', 'Étendre le processus de gestion des correctifs aux serveurs et équipements réseau, avec des délais d\'application selon la criticité des vulnérabilités.'],
  ['M-NET-1', 'Sécurité réseau', 'Cloisonnement réseau', 'Segmenter le réseau en zones de sécurité (utilisateurs, serveurs, administration, DMZ) et filtrer les flux entre zones.'],
  ['M-INC-1', 'Gestion des incidents', 'Processus de gestion des incidents', 'Formaliser un processus de gestion des incidents de sécurité (détection, qualification, escalade, réponse, retour d\'expérience) et réaliser des exercices de crise.'],
  ['M-CONT-1', 'Continuité', 'Plan de continuité', 'Finaliser le plan de continuité d\'activité, identifier les applications critiques et réaliser un test annuel de bascule.']
];

const out = (f) => path.join(__dirname, f);
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(questionnaire);
ws['!cols'] = [{ wch: 9 }, { wch: 22 }, { wch: 60 }, { wch: 12 }, { wch: 70 }, { wch: 50 }, { wch: 10 }];
XLSX.utils.book_append_sheet(wb, ws, 'Évaluation');
XLSX.writeFile(wb, out('questionnaire-exemple.xlsx'));

const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(referential), 'Mesures');
XLSX.writeFile(wb2, out('referentiel-mesures-exemple.xlsx'));
console.log('Sample files written to', __dirname);
