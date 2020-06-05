import React, { useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import Fab from "@material-ui/core/Fab";
import AppsIcon from "@material-ui/icons/Apps";
import ImportantDevicesIcon from "@material-ui/icons/ImportantDevices";
import HomeIcon from "@material-ui/icons/Home";
import CalendarIcon from "@material-ui/icons/CalendarToday";
import OutdoorGrillIcon from "@material-ui/icons/OutdoorGrill";
import Link from "../../components/Link/Link";
import DarkModeToggle from "../DarkModeToggle/DarkModeToggle";

const dialRadius = 32;
const spacingActions = 16;

const useStyles = makeStyles((theme) => ({
  speedDialContainer: {
    position: "fixed",
    bottom: theme.spacing(2),
    right: theme.spacing(2),
    zIndex: theme.zIndex.tooltip,
    display: "flex",
    flexDirection: "column-reverse",
    alignItems: "center",
  },
  actions: {
    display: "flex",
    flexDirection: "column-reverse",
    marginBottom: -dialRadius,
    paddingBottom: spacingActions + dialRadius,
  },
  actionsClosed: {
    display: "none",
  },
}));

const routes = [
  { to: "/", icon: HomeIcon, name: "Home" },
  { to: "/portfolio", icon: ImportantDevicesIcon, name: "Portfolio" },
  { to: "/lab", icon: OutdoorGrillIcon, name: "Lab" },
  {
    to: "/calendar",
    icon: CalendarIcon,
    name: "Calendar",
  },
  {
    to: "toggle",
    icon: DarkModeToggle,
    name: "Dark Mode",
  },
];

const SpeedDial = ({ isDarkMode, toggleDarkMode }) => {
  const [open, setOpen] = useState(false);
  const { speedDialContainer, actions, actionsClosed } = useStyles();
  const handleClick = () => setOpen(!open);
  return (
    <div className={speedDialContainer}>
      <Fab onClick={handleClick}>
        <AppsIcon fontSize="large" />
      </Fab>
      <div className={[actions, !open ? actionsClosed : ""].join(" ")}>
        {routes.map(({ icon: RouteIcon, to, name }) => {
          return to === "toggle" ? (
            <RouteIcon
              key={name}
              isDarkMode={isDarkMode}
              toggleDarkMode={toggleDarkMode}
            />
          ) : (
            <Link key={name} variant="icon" to={to} onClick={handleClick}>
              <RouteIcon />
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default SpeedDial;
