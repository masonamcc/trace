import logo from "../assets/trace_favicon.png";

export default function SplashScreen({ fading }) {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 1000,
      background: "#0d0d0d",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      animation: fading ? "splashOut 0.55s ease forwards" : undefined,
    }}>
      <img
        src={logo}
        alt={''}
        style={{
          width: 80,
          height: 80,
          animation: "splashIn 2s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}
      />
      <style>{`
        @keyframes splashIn {
          from { transform: scale(0.55); opacity: 0; }
          35%  { opacity: 1; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes splashOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
