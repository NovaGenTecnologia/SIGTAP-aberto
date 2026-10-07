import { Link, type LinkProps } from "react-aria-components";
import "./base.css";

export function Ligacao(props: Omit<LinkProps, "className">) {
  return <Link {...props} className="ligacao" />;
}
