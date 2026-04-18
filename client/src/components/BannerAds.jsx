import { useEffect, useState } from "react";

export default function BannerAds({ location = "USA" }) {
  const [ads, setAds] = useState([]);

  useEffect(() => {
    fetch(`/api/ads?location=${encodeURIComponent(location)}`)
      .then(r => r.json())
      .then(data => setAds(data.ads || []));
  }, [location]);

  if (!ads.length) return null;

  return (
    <div className="banner-ads">
      {ads.map(ad => (
        <div key={ad.id} className="banner-ad">
          {ad.image && <img src={ad.image} alt={ad.title} style={{ maxHeight: 80 }} />}
          <div>
            <strong>{ad.title}</strong>
            <p>{ad.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
