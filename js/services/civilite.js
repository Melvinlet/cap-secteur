// Civilité d'un contact pour les messages : « Bonjour Monsieur » / « Bonjour Madame », jamais le prénom.
// 1. choisie par l'utilisateur (contact.civilite) ; 2. écrite dans le nom (M., Mr, Mme, Mlle…) ;
// 3. devinée d'après le prénom ; sinon rien (« Bonjour »).
const F = `agathe agnes aicha alexandra alexane alice alicia aline alix_ amandine amelie anais andrea_ angelique anne annabelle annie anne-laure anne-marie anne-sophie annick anouk apolline ariane armelle audrey aurelie aurore axelle beatrice benedicte berangere bernadette brigitte camille_ capucine carine carole caroline cassandra catherine cecile celia celine chantal charlene charlotte chloe christele christelle christiane christine claire clara clarisse claudine clemence clementine colette coralie corinne cyrielle daniele danielle delphine denise diane dominique_ dorothee edith elena eliane elise elisabeth elodie eloise elsa emilie emma emmanuelle estelle eva evelyne fabienne fanny fatima florence francoise frederique gaelle genevieve geraldine ghislaine gisele helene heloise ines ingrid irene isabelle jacqueline jeanne jessica johanna josiane joelle josephine julia julie juliette justine karine katel katia laetitia lea leila lena liliane linda line lise lola lou louise lucie ludivine lydie madeleine maelle magali manon marceline margaux margot marianne marie marie-claire marie-france marie-laure marine marion martine maryline mathilde maud maude melanie melissa melodie michele michelle mireille monique morgane muriel myriam nadia nadine nathalie nelly nicole noemie oceane odile olivia pascale patricia paule pauline perrine rachel rebecca regine rose rosine sabine sabrina salome samira sandra sandrine sara sarah severine sophie stephanie suzanne sylvie tatiana tiphaine thiphaine valentine valerie vanessa veronique victoria virginie yasmine yvette yvonne zineb zoe laurie laure laurence garance charline elea ophelie gwenaelle gwendoline nolwenn soazig rozenn enora maela anaelle annaig`;
const M = `adrien alain alan alexandre alexis alexander alfred amaury andre antoine anthony antonin arnaud arthur aurelien axel baptiste basile benjamin benoit bernard bertrand bradley brice bruno bastien cedric charles christian christophe christopher clement corentin cyril cyrille damien daniel david denis didier dimitri dorian edouard emilien emmanuel eric erwan etienne fabien fabrice florent florian francis franck francois frederic gabriel gael gaetan gauthier gautier geoffrey georges gerald gerard gilles gilbert gregoire gregory guillaume guy harold henri herve hugo hugues jacques jean jean-baptiste jean-charles jean-claude jean-francois jean-luc jean-marc jean-marie jean-michel jean-paul jean-philippe jean-pierre jeremie jeremy jerome joel johan johann jonathan jordan joseph julien kevin karim lionel loic lorick louis luc lucas ludovic marc marcel martin mathieu matthieu mateo maxence maxime michael mickael michel mohamed morgan nicolas noel olivier oliviers omar pascal patrice patrick paul philippe pierre pierrick quentin rachid raphael raymond regis remi renaud richard robert rodolphe romain roman ronan samuel sebastien serge simon stephane steven sylvain theo thibault thibaut thierry thomas tom tony tristan valentin victor vincent walter william xavier yann yannick yoann yohann yves gwenael tanguy erwan killian kylian loan enzo nathan noah ewan mael malo goulven yvon herve said walid ichem gaston guillain ghislain wielfried joevin emeric aymeric`;
const sansAccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const FEM = new Set(F.split(/\s+/).filter(x => !x.endsWith('_')));
const MASC = new Set(M.split(/\s+/));
// prénoms mixtes (marqués d'un _) : on ne devine pas
const MIXTES = new Set([...F.split(/\s+/).filter(x => x.endsWith('_')).map(x => x.slice(0, -1)), 'claude', 'dominique', 'camille', 'sacha', 'alix', 'dany', 'andrea', 'morgan', 'charlie', 'eden', 'lou', 'yaelle']);

export function civiliteDe(c) {
  if (!c) return null;
  if (['M', 'Mme', 'MmeM'].includes(c.civilite)) return c.civilite;
  if (c.civilite === 'aucune') return null;
  const nom = sansAccent((c.nom || '').trim());
  if (/^(mme|mlle|mle|madame|mademoiselle|mrs|ms)\b\.?/.test(nom)) return 'Mme';
  if (/^(m|mr|monsieur)\b\.?\s/.test(nom) || /^m\.\s?/.test(nom)) return 'M';
  // un couple (« Guillaume & Sylvie », « Alexane/Christophe ») : Madame, Monsieur
  const parts = nom.split(/\s*(?:&|\bet\b|\/|\+)\s*/).filter(Boolean);
  if (parts.length > 1) { const g = new Set(parts.map(x => civiliteDe({ nom: x }))); if (g.has('M') && g.has('Mme')) return 'MmeM'; }
  const mots = nom.split(/[\s/]+/).filter(Boolean);
  for (const p of [mots.slice(0, 2).join('-'), mots[0], (mots[0] || '').split('-')[0]]) {
    if (!p || MIXTES.has(p)) return null;
    if (FEM.has(p)) return 'Mme';
    if (MASC.has(p)) return 'M';
  }
  return null;
}
export const civiliteDevinee = c => civiliteDe({ ...c, civilite: undefined });
// « Bonjour Monsieur » / « Bonjour Madame » / « Bonjour »
export const bonjourDe = c => ({ M: 'Bonjour Monsieur', Mme: 'Bonjour Madame', MmeM: 'Bonjour Madame, Monsieur' })[civiliteDe(c)] || 'Bonjour';
