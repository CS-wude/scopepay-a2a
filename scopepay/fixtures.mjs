// Original demonstration copy, authored for this project.
export const SOURCE_SRT=`1
00:00:00,000 --> 00:00:05,000
Meet Aurora, a quieter start to your day.

2
00:00:05,000 --> 00:00:11,000
One touch brings a gentle light to your desk.

3
00:00:11,000 --> 00:00:17,000
Choose a warm glow for reading and creating.

4
00:00:17,000 --> 00:00:24,000
Thoughtful design leaves more room for what matters.

5
00:00:24,000 --> 00:00:30,000
Discover Aurora. Make space for a better morning.
`;
export const FRENCH_SRT=`1
00:00:00,000 --> 00:00:05,000
Voici Aurora, pour commencer la journée en douceur.

2
00:00:05,000 --> 00:00:11,000
Un simple geste éclaire votre bureau d'une lumière douce.

3
00:00:11,000 --> 00:00:17,000
Choisissez une lueur chaleureuse pour lire et créer.

4
00:00:17,000 --> 00:00:24,000
Un design soigné laisse plus de place à l'essentiel.

5
00:00:24,000 --> 00:00:30,000
Découvrez Aurora. Faites place à un matin plus agréable.
`;
export const CASES={
  standard:{label:'Color + French + rush',request:'Make it blue, add French subtitles, and deliver today.',selection:{color:true,french:true,rush:true}},
  included:{label:'Included color revision only',request:'Use the included color revision to make it blue. Keep everything else unchanged.',selection:{color:true,french:false,rush:false}},
};
