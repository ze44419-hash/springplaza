/** Brand mark: five-petal blossom. */
export default function Blossom({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      <rect width="96" height="96" rx="22" fill="#2E7358" />
      <g transform="translate(48 50)" fill="#FCE3EA">
        {[0, 72, 144, 216, 288].map((r) => <ellipse key={r} rx="10" ry="20" transform={`rotate(${r}) translate(0 -14)`} />)}
      </g>
      <circle cx="48" cy="50" r="7" fill="#E9A93A" />
    </svg>
  );
}
