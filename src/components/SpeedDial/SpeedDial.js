import React, { useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import Fab from "@material-ui/core/Fab";
import AppsIcon from "@material-ui/icons/Apps";
import ImportantDevicesIcon from "@material-ui/icons/ImportantDevices";
import HomeIcon from "@material-ui/icons/Home";
// import OutdoorGrillIcon from "@material-ui/icons/OutdoorGrill";
import WorkIcon from "@material-ui/icons/Work";
import Link from "../../components/Link/Link";
import IconButton from "@material-ui/core/IconButton";
import Brightness2 from "@material-ui/icons/Brightness2";
import Brightness5 from "@material-ui/icons/Brightness5";
import ClickAwayListener from "@material-ui/core/ClickAwayListener";

import Fade from "@material-ui/core/Fade";
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
  iconButton: {
    background: theme.palette.primary.main,
    marginTop: theme.spacing(1),
    "&:hover": {
      background: theme.palette.primary.dark,
    },
  },
}));

const routes = [
  { to: "/", icon: HomeIcon, name: "Home" },
  { to: "/portfolio", icon: ImportantDevicesIcon, name: "Portfolio" },
  { to: "/jobs", icon: WorkIcon, name: "Jobs" },
  // { to: "/lab", icon: OutdoorGrillIcon, name: "Lab" },
  {
    to: "toggle",
    name: "Dark Mode",
  },
];

const SpeedDial = ({ isDarkMode, toggleDarkMode }) => {
  const [open, setOpen] = useState(false);
  const {
    speedDialContainer,
    actions,
    actionsClosed,
    iconButton,
  } = useStyles();
  const handleClick = () => setOpen(!open);
  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <div className={speedDialContainer}>
        <Fab onClick={handleClick}>
          <AppsIcon fontSize="large" />
        </Fab>
        <Fade in={open} timeout={500}>
          <div className={[actions, !open ? actionsClosed : ""].join(" ")}>
            {routes.map(({ icon: RouteIcon, to, name }, index) => {
              return to === "toggle" ? (
                <IconButton
                  key={name}
                  className={iconButton}
                  onClick={toggleDarkMode}
                >
                  {isDarkMode ? <Brightness5 /> : <Brightness2 />}
                </IconButton>
              ) : (
                <Link
                  className={iconButton}
                  variant="icon"
                  to={to}
                  onClick={handleClick}
                >
                  <RouteIcon />
                </Link>
              );
            })}
          </div>
        </Fade>
      </div>
    </ClickAwayListener>
  );
};

export default SpeedDial;
