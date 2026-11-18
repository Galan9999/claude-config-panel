// How to read an eval result.
//
// A score is not a verdict on a skill. It is the output of a measuring
// instrument with four moving parts — the prompt, the rubric, the judge and
// the model — and reading a result means working out which of the four moved.
// This file is the reference the panel renders; keeping it as data rather than
// markup means the triage table and the glossary cannot drift apart.

/** The shapes a result comes in, and what each one actually tells you. */
export const DIAGNOSES = [
  {
    id: 'earns-it',
    delta: 'alto', fired: 'n/n', arms: 'con pasa · sin falla',
    level: 'good',
    meaning: 'La skill se carga y cambia la respuesta. Es el único caso en que el número habla de la skill y no de otra cosa.',
    action: 'Nada. Y a partir de ahora el caso es un test de regresión: vuelve a correrlo cada vez que edites la skill.',
    culprit: 'ninguno',
  },
  {
    id: 'base-model-knew',
    delta: '0', fired: 'n/n', arms: 'los dos pasan',
    level: 'mid',
    meaning: 'El modelo base ya acertaba sin la skill. El caso está midiendo al modelo, no a tu configuración.',
    action: 'Endurece el caso: pide algo que sólo se sepa leyendo este repo — un helper concreto, una convención medida, un número. Si tras endurecerlo sigue en 0, la skill paga contexto por nada.',
    culprit: 'la rúbrica (demasiado fácil)',
  },
  {
    id: 'skill-broken',
    delta: '0', fired: 'n/n', arms: 'los dos fallan',
    level: 'bad',
    meaning: 'La skill se carga y aun así no produce la respuesta correcta. Esto sí es la skill.',
    action: 'Antes de tocarla, lee las dos respuestas y re-juzga con sonnet. Si el fallo se mantiene, el cuerpo de la skill no dice lo que creías que decía.',
    culprit: 'la skill, o el juez',
  },
  {
    id: 'never-fired',
    delta: '—', fired: '0/n en un caso positivo', arms: 'da igual',
    level: 'bad',
    meaning: 'La skill no llegó a cargarse, así que la nota es del modelo base con otro nombre. El Δ de esta fila no significa nada.',
    action: 'Reescribe la `description` como «Use when <situación concreta>». Es lo único que activa una skill, y arreglarlo no cuesta ni un run.',
    culprit: 'la description',
  },
  {
    id: 'quiet-and-right',
    delta: '0', fired: '0/n en un caso negativo', arms: 'el base pasa',
    level: 'good',
    meaning: 'La skill se calló donde debía. El caso negativo existe justo para esto.',
    action: 'Nada. El Δ que salga aquí es varianza del modelo base, no señal: no lo interpretes.',
    culprit: 'ninguno',
  },
  {
    id: 'false-positive-guard',
    delta: 'alto', fired: 'n/n', arms: 'con pasa · sin falla, en un caso negativo',
    level: 'good',
    meaning: 'El modelo base se inventa un problema que no existe y la skill lo frena. Un caso negativo no mide sólo que la skill calle: mide que evita el falso positivo.',
    action: 'Nada. Es tan valioso como un positivo, y se lee al revés que el anterior: aquí disparar está bien.',
    culprit: 'ninguno',
  },
  {
    id: 'judge-noise',
    delta: 'cualquiera', fired: 'n/n', arms: 'votos partidos (T F F)',
    level: 'mid',
    meaning: 'El juez no se pone de acuerdo consigo mismo sobre respuestas casi idénticas. La varianza es del instrumento, no de lo medido.',
    action: 'Re-juzga el caso con `--judge-model sonnet` antes de cambiar nada. Cuesta ~$0,008 por run en vez de ~$0,001, y es más barato que triplicar las corridas.',
    culprit: 'el juez',
  },
  {
    id: 'harmful',
    delta: 'negativo', fired: 'n/n', arms: 'con falla · sin pasa',
    level: 'bad',
    meaning: 'La skill empeora la respuesta. Es raro y es lo más grave que puede salir.',
    action: 'Para y lee las dos respuestas enteras antes de tocar nada. Suele ser una instrucción de la skill que desvía al modelo de lo que ya hacía bien.',
    culprit: 'la skill',
  },
];

/** What a number of runs is actually worth, by the exact test. */
export const RUNS = [
  ['1 run', '1/1 vs 0/1', '50 %', 'bad',
    'No es evidencia. Sirve para iterar la rúbrica y ver que el caso corre, nada más.'],
  ['3 runs', '3/3 vs 0/3', '5 %', 'mid',
    'El mínimo defendible, y sólo con el reparto limpio. Un 2/3 contra 1/3 sale por azar la mitad de las veces.'],
  ['5 runs', '5/5 vs 0/5', '0,4 %', 'good',
    'Lo que hace falta para resolver un Δ parcial, no sólo uno limpio.'],
];

/** The two places the noise comes from, and which one to pay to fix first. */
export const VARIANCE = [
  ['El modelo responde distinto cada vez', 'Se muestrea con más runs', '~$0,044 por run',
    'Es la fuente que todo el mundo asume.'],
  ['El juez puntúa distinto la misma respuesta', 'No lo arregla ningún número de runs', '~$0,008 por run pasar a sonnet',
    'Medido en este banco: tres respuestas casi idénticas sacaron [F,F,T], [F,T,F] y [T,T,T] con haiku, y 3/3 unánime con sonnet. Era el juez.'],
];

/** The honest limits. A reader who skips these will over-trust the numbers. */
export const LIMITS = [
  ['Mide acuerdo con una rúbrica, no verdad',
    'Si la rúbrica pide algo que la skill no dice, el 0 es de la rúbrica. Si pide algo trivial, el 1 no vale nada. Lee siempre la rúbrica antes que el número.'],
  ['Un caso es una sola forma de preguntar',
    'Una skill puede ganar con esta redacción y perder con la tuya. Dos casos positivos que preguntan distinto valen más que uno repetido tres veces.'],
  ['Varios casos multiplican el azar',
    'Con 4 casos a p=0,05 cada uno, la probabilidad de que al menos uno parezca significativo por suerte es ~19 %. Un 3/3 suelto dentro de una suite vale menos que el mismo 3/3 solo.'],
  ['El Δ se mide con la skill sola',
    'En el banco se carga sin competencia. En tu sesión real compiten decenas por activarse, así que disparar aquí no garantiza disparar allí. Para eso está el contador de uso, no el eval.'],
  ['La puntuación deja de ser binaria si añades graders que puntúan',
    'La tabla de significancia de arriba asume un pasa/no pasa por run. Con dos graders `llm` ponderados las notas son fraccionarias y el test exacto ya no aplica tal cual.'],
];

/** The loop, in the order that spends the least. */
export const LOOP = [
  ['1', 'Escribe el caso y la rúbrica', 'gratis',
    'Criterios numerados y una condición de fallo explícita. Sin la condición de fallo el juez aprueba respuestas genéricas.'],
  ['2', '¿Dispara?', '~$0,08',
    '`--case <uno> --ablation none --runs 1` con sólo el grader `tool_used`. Si no dispara, para aquí: lo que hay que arreglar es la `description` y eso es gratis.'],
  ['3', 'Itera la rúbrica', '~$0,6 la suite',
    '`--runs 1`. Lee las dos respuestas. Casi todo lo que parece un fallo de la skill en esta fase es la rúbrica.'],
  ['4', 'Fíjalo', '~$1,9 la suite',
    '`--runs 3 -j 2 --judge-model sonnet`. Sólo cuando los casos ya son estables: es la corrida que te puedes creer.'],
  ['5', 'Úsalo como regresión', 'el mismo coste, cuando toca',
    'Vuelve a correrlo cada vez que edites la skill. Aquí es donde el gasto se amortiza: te dice si al recortar 300 líneas rompiste algo.'],
];
