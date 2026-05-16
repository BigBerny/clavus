import { memo } from "react"

type SvgProps = React.ComponentPropsWithoutRef<"svg">

export const RawTextIcon = memo(({ className, ...props }: SvgProps) => {
  return (
    <svg
      width="24"
      height="24"
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.707 7.293a1 1 0 010 1.414L6.414 12l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0zM14.293 7.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L17.586 12l-3.293-3.293a1 1 0 010-1.414z"
        fill="currentColor"
      />
    </svg>
  )
})

RawTextIcon.displayName = "RawTextIcon"
