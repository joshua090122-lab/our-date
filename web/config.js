/* Public configuration shared by every device. Passwords belong in Vercel environment variables. */
(function (root) {
  const config = Object.freeze({
    passwordGate: true,
    appOrigin: "https://our-date-pi.vercel.app",
    supabaseUrl: "https://kehjlcsrjfpaaqqhehon.supabase.co",
    publishableKey: "sb_publishable_UMiR02gNbGGMazTQ7tyQzQ_h_E34xne",
    kakaoKey: "01593512e7bc4ac10ce555e1e7093c7b"
  });
  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.OUR_DATE_CONFIG = config;
})(typeof window !== 'undefined' ? window : globalThis);
