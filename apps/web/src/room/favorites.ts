export type FavoriteItems = Partial<Record<"flowers" | "food" | "drinks" | "colors" | "places" | "films" | "artists" | "scents", string[]>>;

export const FLOWERS = ["rose", "tulip", "sunflower", "lily", "daisy", "lavender", "jasmine", "orchid", "blossom", "carnation", "lotus"] as const;
export const PLACES = ["paris", "pyramids", "sea", "london", "newyork", "japan", "rome", "istanbul", "mountains", "santorini", "desert"] as const;
export const FILMS = ["ship", "wizard", "spirit", "starry", "snowflake", "space", "lion", "lantern", "heart", "toy", "guitar"] as const;
export const ARTISTS = ["oud", "piano", "guitar", "violin", "tarab", "band"] as const;
export const FOODS = ["cake", "cookies", "chocolate", "strawberries", "donut", "croissant", "pizza", "icecream", "popcorn", "fruit", "sweets", "koshary", "pancakes"] as const;
export const DRINKS = ["tea", "coffee", "juice", "lemonade", "karkade", "milk", "matcha", "soda"] as const;

export type FlowerArt = (typeof FLOWERS)[number] | "default";
export type PlaceArt = (typeof PLACES)[number] | "default";
export type FilmArt = (typeof FILMS)[number] | "default";
export type ArtistArt = (typeof ARTISTS)[number] | "default";
export type FoodArt = (typeof FOODS)[number] | "default";
export type DrinkArt = (typeof DRINKS)[number] | "default";

export type FavoriteArt = {
  flower: FlowerArt;
  accent: string | null;
  books: string[];
  place: PlaceArt;
  film: FilmArt;
  artist: ArtistArt;
  food: FoodArt;
  drink: DrinkArt;
};

export const DEFAULT_FAVORITES: FavoriteArt = {
  flower: "default",
  accent: null,
  books: [],
  place: "default",
  film: "default",
  artist: "default",
  food: "default",
  drink: "default",
};

type Table<T extends string> = Record<T, string[]>;

const FLOWER_WORDS: Table<(typeof FLOWERS)[number]> = {
  rose: ["rose", "roses", "ورد", "ورده", "ورود", "روز", "جوري"],
  tulip: ["tulip", "tulips", "توليب", "تيوليب", "التيوليب"],
  sunflower: ["sunflower", "sunflowers", "عباد الشمس", "عباد شمس", "دوار الشمس"],
  lily: ["lily", "lilies", "زنبق", "ليلي", "سوسن", "ليليام"],
  daisy: ["daisy", "daisies", "chamomile", "اقحوان", "ديزي", "مارجريت", "بابونج", "كاموميل"],
  lavender: ["lavender", "لافندر", "خزامي", "لافاندر"],
  jasmine: ["jasmine", "ياسمين", "فل"],
  orchid: ["orchid", "orchids", "اوركيد", "اوركيدا", "سحلبيه"],
  blossom: ["cherry blossom", "cherry blossoms", "sakura", "blossom", "blossoms", "ساكورا", "زهر الكرز", "ازهار الكرز", "زهور الكرز"],
  carnation: ["carnation", "carnations", "قرنفل"],
  lotus: ["lotus", "لوتس", "بشنين"],
};

const COLOR_WORDS: [string, string[]][] = [
  ["#d9534f", ["red", "crimson", "scarlet", "احمر", "حمرا", "الاحمر"]],
  ["#e88fa3", ["pink", "baby pink", "rose pink", "وردي", "بمبي", "بينك", "روز"]],
  ["#9b77c4", ["purple", "violet", "lilac", "lavender", "بنفسجي", "موف", "ليلكي", "بنفسجى", "لافندر"]],
  ["#4985cc", ["blue", "navy", "sky blue", "baby blue", "ازرق", "زرقا", "كحلي", "لبني", "سماوي"]],
  ["#5aa37e", ["green", "olive", "mint", "sage", "اخضر", "خضرا", "زيتي", "منت", "نعناعي"]],
  ["#e8c25a", ["yellow", "mustard", "lemon", "اصفر", "صفرا", "خردلي", "ليموني"]],
  ["#e8924a", ["orange", "coral", "برتقالي", "اورنج", "مرجاني", "برتقاني"]],
  ["#3aa6a0", ["teal", "turquoise", "aqua", "تركواز", "فيروزي", "تركوازي", "تيل"]],
  ["#8c2f45", ["burgundy", "maroon", "wine", "نبيتي", "عنابي", "خمري"]],
  ["#d4a63a", ["gold", "golden", "ذهبي", "دهبي"]],
  ["#f2a98a", ["peach", "apricot", "خوخي", "بيتش", "مشمشي"]],
  ["#8a5a3c", ["brown", "chocolate brown", "coffee", "بني", "بنى", "قهوه"]],
  ["#d6bf9c", ["beige", "cream", "nude", "بيج", "كريمي", "سكري"]],
  ["#f2ece0", ["white", "off white", "ابيض", "بيضا", "اوف وايت"]],
  ["#9aa0b0", ["grey", "gray", "silver", "رمادي", "فضي", "رصاصي"]],
  ["#3d3a4a", ["black", "اسود", "سودا"]],
];

const PLACE_WORDS: Table<(typeof PLACES)[number]> = {
  paris: ["paris", "france", "eiffel", "باريس", "فرنسا", "ايفل"],
  pyramids: ["cairo", "egypt", "pyramids", "pyramid", "giza", "luxor", "aswan", "القاهره", "مصر", "اهرامات", "الاهرام", "اهرام", "الجيزه", "جيزه", "الاقصر", "اقصر", "اسوان"],
  sea: [
    "alexandria", "alex", "beach", "sea", "ocean", "sahel", "north coast", "hurghada", "sharm", "dahab", "marsa matrouh", "maldives", "ain sokhna",
    "اسكندريه", "الاسكندريه", "اسكندرية", "شاطئ", "شط", "بحر", "البحر", "محيط", "الساحل", "الغردقه", "شرم", "دهب", "مرسي مطروح", "المالديف", "السخنه",
  ],
  london: ["london", "england", "uk", "big ben", "لندن", "انجلترا", "بريطانيا"],
  newyork: ["new york", "nyc", "manhattan", "نيويورك", "منهاتن"],
  japan: ["japan", "tokyo", "kyoto", "fuji", "osaka", "اليابان", "طوكيو", "كيوتو", "فوجي", "اوساكا"],
  rome: ["rome", "italy", "venice", "florence", "milan", "روما", "ايطاليا", "فينيسيا", "البندقيه", "فلورنسا", "ميلانو"],
  istanbul: ["istanbul", "turkey", "cappadocia", "اسطنبول", "تركيا", "كابادوكيا"],
  mountains: ["mountain", "mountains", "alps", "switzerland", "sinai", "saint catherine", "jabal", "جبل", "جبال", "الالب", "سويسرا", "سيناء", "سانت كاترين"],
  santorini: ["santorini", "greece", "athens", "سانتوريني", "اليونان", "اثينا"],
  desert: ["desert", "siwa", "oasis", "sahara", "صحراء", "سيوه", "واحه", "الواحات"],
};

const FILM_WORDS: Table<(typeof FILMS)[number]> = {
  ship: ["titanic", "تايتانيك", "تيتانيك", "pirates of the caribbean", "قراصنه الكاريبي"],
  wizard: ["harry potter", "hogwarts", "هاري بوتر", "هوجوورتس"],
  spirit: ["spirited away", "ghibli", "totoro", "howl", "ponyo", "kiki", "المخطوفه", "جيبلي", "توتورو", "هاول", "بونيو"],
  starry: ["la la land", "لا لا لاند"],
  snowflake: ["frozen", "elsa", "فروزن", "ملكه الثلج", "السا"],
  space: ["interstellar", "star wars", "gravity", "the martian", "wall-e", "walle", "انترستيلر", "حرب النجوم", "وول اي"],
  lion: ["lion king", "الاسد الملك", "ملك الاسود", "ملك الغابه"],
  lantern: ["tangled", "rapunzel", "ريبونزل", "رابونزل", "تانجلد"],
  heart: ["the notebook", "notebook", "pride and prejudice", "before sunrise", "about time", "a walk to remember", "me before you", "ذا نوت بوك", "كبرياء وتحامل", "كبرياء وهوى"],
  toy: ["toy story", "حكايه لعبه", "قصه لعبه"],
  guitar: ["coco", "كوكو", "sing street", "once"],
};

const ARTIST_WORDS: Table<(typeof ARTISTS)[number]> = {
  oud: ["oud", "عود", "نصير شمه", "naseer shamma"],
  piano: ["piano", "بيانو", "yanni", "ياني", "omar khairat", "عمر خيرت", "chopin", "شوبان", "ludovico", "einaudi"],
  guitar: ["guitar", "جيتار", "غيتار", "ed sheeran", "اد شيران", "taylor swift", "تايلور سويفت"],
  violin: ["violin", "كمان", "كمنجه"],
  tarab: [
    "umm kulthum", "oum kalthoum", "om kalthoum", "fairuz", "fairouz", "abdel halim", "abdelhalim", "abdel wahab", "warda", "mohamed mounir",
    "ام كلثوم", "فيروز", "عبد الحليم", "عبدالحليم", "عبد الوهاب", "ورده", "محمد منير", "منير",
  ],
  band: ["cairokee", "coldplay", "bts", "arctic monkeys", "the beatles", "beatles", "queen", "massar egbari", "كايروكي", "كولدبلاي", "مسار اجباري", "بي تي اس"],
};

const FOOD_WORDS: Table<(typeof FOODS)[number]> = {
  cake: ["cake", "cheesecake", "cupcake", "cupcakes", "كيك", "كيكه", "كعكه", "تورته", "تشيز كيك", "كب كيك"],
  cookies: ["cookie", "cookies", "biscuit", "biscuits", "كوكيز", "بسكويت", "كحك", "بيتي فور"],
  chocolate: ["chocolate", "nutella", "brownie", "brownies", "شوكولاته", "شيكولاته", "شوكولا", "نوتيلا", "براونيز", "براوني"],
  strawberries: ["strawberry", "strawberries", "فراوله"],
  donut: ["donut", "donuts", "doughnut", "doughnuts", "دونات", "دونتس"],
  croissant: ["croissant", "croissants", "كرواسون", "كرواسان"],
  pizza: ["pizza", "بيتزا"],
  icecream: ["ice cream", "icecream", "gelato", "ايس كريم", "ايسكريم", "جيلاتي", "بوظه"],
  popcorn: ["popcorn", "فشار"],
  fruit: ["fruit", "fruits", "mango", "watermelon", "apple", "apples", "banana", "grapes", "cherries", "فاكهه", "فواكه", "مانجو", "مانجا", "بطيخ", "تفاح", "موز", "عنب", "كرز"],
  sweets: ["kunafa", "konafa", "kunafeh", "basbousa", "baklava", "qatayef", "zalabya", "كنافه", "بسبوسه", "بقلاوه", "قطايف", "زلابيه", "لقمه القاضي", "حلويات شرقي"],
  koshary: ["koshary", "koshari", "kushari", "كشري"],
  pancakes: ["pancake", "pancakes", "waffle", "waffles", "crepe", "crepes", "بان كيك", "بانكيك", "وافل", "كريب"],
};

const DRINK_WORDS: Table<(typeof DRINKS)[number]> = {
  tea: ["tea", "mint tea", "green tea", "chai", "شاي", "شاي بالنعناع", "شاي اخضر"],
  coffee: ["coffee", "latte", "cappuccino", "espresso", "nescafe", "mocha", "americano", "flat white", "قهوه", "لاتيه", "كابتشينو", "كابوتشينو", "اسبريسو", "اسبرسو", "نسكافيه", "موكا"],
  juice: ["juice", "orange juice", "mango juice", "عصير", "برتقال", "عصير مانجو", "عصير برتقال"],
  lemonade: ["lemonade", "lemon", "mint lemonade", "ليمون", "ليموناده", "لمون", "ليمون نعناع"],
  karkade: ["karkade", "hibiscus", "كركديه"],
  milk: ["milk", "hot chocolate", "sahlab", "milkshake", "لبن", "حليب", "هوت شوكليت", "شوكولاته ساخنه", "سحلب", "ميلك شيك"],
  matcha: ["matcha", "ماتشا", "bubble tea", "boba", "بوبا"],
  soda: ["soda", "cola", "coke", "pepsi", "sprite", "كولا", "بيبسي", "كوكاكولا", "سبرايت"],
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function hasWord(text: string, word: string): boolean {
  const w = normalize(word);
  if (!w) return false;
  const padded = ` ${text} `;
  if (padded.includes(` ${w} `)) return true;
  if (/^[؀-ۿ]/.test(w)) return padded.includes(` ال${w} `) || padded.includes(` بال${w} `) || padded.includes(` و${w} `);
  return padded.includes(` ${w}s `) || padded.includes(` ${w}es `);
}

function pick<T extends string>(items: string[] | undefined, table: Table<T>): T | "default" {
  for (const raw of items ?? []) {
    const text = normalize(raw);
    if (!text) continue;
    let best: { art: T; len: number } | null = null;
    for (const art of Object.keys(table) as T[]) {
      for (const word of table[art]) {
        if (hasWord(text, word) && (!best || word.length > best.len)) best = { art, len: word.length };
      }
    }
    if (best) return best.art;
  }
  return "default";
}

export function colorsOf(items: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of items ?? []) {
    const text = normalize(raw);
    let best: { hex: string; len: number } | null = null;
    for (const [hex, words] of COLOR_WORDS) {
      for (const word of words) if (hasWord(text, word) && (!best || word.length > best.len)) best = { hex, len: word.length };
    }
    if (best && !out.includes(best.hex)) out.push(best.hex);
  }
  return out;
}

export function favoriteArt(items: FavoriteItems | null | undefined): FavoriteArt {
  if (!items) return DEFAULT_FAVORITES;
  const colors = colorsOf(items.colors);
  return {
    flower: pick(items.flowers, FLOWER_WORDS),
    accent: colors[0] ?? null,
    books: colors.slice(0, 3),
    place: pick(items.places, PLACE_WORDS),
    film: pick(items.films, FILM_WORDS),
    artist: pick(items.artists, ARTIST_WORDS),
    food: pick(items.food, FOOD_WORDS),
    drink: pick(items.drinks, DRINK_WORDS),
  };
}

export const favoritesKey = (f: FavoriteArt) => [f.flower, f.accent, f.books.join("+"), f.place, f.film, f.artist, f.food, f.drink].join("|");
