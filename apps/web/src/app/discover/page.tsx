"use client";

import { HolidaySection, RadioSection, WeatherMixSection } from "@/components/mixes/DiscoverSections";
import { MixShelf, ReleasesShelf, TimeMixShelf } from "@/components/mixes/Mixes";
import { PageHero } from "@/components/sky/PageHero";
import { MADE_FOR_YOU, MOOD_MIXES, TIME_MIXES, WEATHER_CONDITIONS, useWeatherMix } from "@/lib/mixes";

function DiscoverHero() {
  const m = useWeatherMix().data;
  const meta = m ? `${m.weather.city} · ${WEATHER_CONDITIONS[m.weather.condition] ?? m.weather.condition} · ${Math.round(m.weather.temperature_c)}°C` : undefined;
  return <PageHero title="Discover" meta={meta} />;
}

export default function DiscoverPage() {
  return (
    <>
      <DiscoverHero />
      <div className="grid grid-cols-1 gap-12">
        <HolidaySection />
        <MixShelf title="Made for you" kinds={MADE_FOR_YOU} />
        <TimeMixShelf kinds={TIME_MIXES} />
        <MixShelf title="Moods" kinds={MOOD_MIXES} />
        <ReleasesShelf />
        <WeatherMixSection />
        <RadioSection />
      </div>
    </>
  );
}
