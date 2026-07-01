import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { zhCN } from "date-fns/locale";

import { cn } from "../../lib/cn";

type CalendarProps = DayPickerProps;

function Calendar({ className, classNames, components, ...props }: CalendarProps) {
  return (
    <DayPicker
      locale={zhCN}
      weekStartsOn={1}
      className={cn("date-calendar", className)}
      classNames={{
        root: "rdp-root",
        months: "rdp-months",
        month: "rdp-month",
        month_caption: "rdp-month_caption",
        caption_label: "rdp-caption_label",
        nav: "rdp-nav",
        button_previous: "rdp-button_previous",
        button_next: "rdp-button_next",
        month_grid: "rdp-month_grid",
        weekdays: "rdp-weekdays",
        weekday: "rdp-weekday",
        weeks: "rdp-weeks",
        week: "rdp-week",
        day: "rdp-day",
        day_button: "rdp-day_button",
        outside: "rdp-outside",
        disabled: "rdp-disabled",
        today: "rdp-today",
        selected: "rdp-selected",
        ...classNames,
      }}
      components={{
        Chevron: ({ className: chevronClassName, orientation, size = 14 }) => {
          const Icon =
            orientation === "left"
              ? ChevronLeft
              : orientation === "right"
                ? ChevronRight
                : ChevronDown;

          return (
            <Icon
              aria-hidden="true"
              className={cn("rdp-chevron", chevronClassName)}
              size={size}
              strokeWidth={2.2}
            />
          );
        },
        ...components,
      }}
      {...props}
    />
  );
}

export { Calendar };
