import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import Link from "../Link/Link";
import IconButton from "@material-ui/core/IconButton";
import Brightness2 from "@material-ui/icons/Brightness2";
import Brightness5 from "@material-ui/icons/Brightness5";
import Grow from "@material-ui/core/Grow";

const useStyles = makeStyles((theme) => ({
  iconButton: {
    background: theme.palette.primary.main,
    marginTop: theme.spacing(1),
    "&:hover": {
      background: theme.palette.primary.dark,
    },
  },
}));

const SpeedDialAction = ({
  to,
  RouteIcon,
  isDarkMode,
  toggleDarkMode,
  handleClick,
  index,
}) => {
  const { iconButton } = useStyles();
  return to === "toggle" ? (
    <Grow in={true} timeout={index === 0 ? 500 : index * 500}>
      <IconButton className={iconButton} onClick={toggleDarkMode}>
        {isDarkMode ? (
          <Brightness5 color="action" />
        ) : (
          <Brightness2 color="action" />
        )}
      </IconButton>
    </Grow>
  ) : (
    <Grow in={true} timeout={index === 0 ? 500 : index * 500}>
      <div>
        <Link
          className={iconButton}
          variant="icon"
          to={to}
          onClick={handleClick}
        >
          <RouteIcon color="action" />
        </Link>
      </div>
    </Grow>
  );
};

export default SpeedDialAction;
