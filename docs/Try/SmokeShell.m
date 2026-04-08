classdef SmokeShell
    properties
        coord = zeros(1,3);
        v0; v; coord_now = zeros(1,3); flag_exist = 0;
    end

    methods
        function [obj,UAV] = SmokeShell(UAV)
            obj.coord = UAV.coord_now;
            obj.coord_now = UAV.coord_now;
            obj.v0 = UAV.v0;
            obj.v = UAV.v;
            UAV.num_shell = UAV.num_shell+1;
        end

        function [obj,pres_coord] = detonate(obj,delta_t)
            obj.v(3) = -9.8*delta_t;
            pres_coord(1) = obj.coord(1)+obj.v(1)*delta_t;
            pres_coord(2) = obj.coord(2)+obj.v(2)*delta_t;
            pres_coord(3) = obj.coord(3)-9.8/2*delta_t^2;
            obj.coord_now = pres_coord;
            obj.flag_exist = 1;
            obj.v(3) = -3; obj.v(1) = 0; obj.v(2) = 0;
        end

        function [obj,pres_coord] = sink(obj,delta_t)
            pres_coord(1:2) = obj.coord_now(1:2);
            pres_coord(3) = obj.coord_now(3)+obj.v(3)*delta_t;
            obj.coord_now = pres_coord;
        end

        function pres_coord = cal_sink_coord(obj,tt)
            pres_coord(1:2) = sym(obj.coord_now(1:2));
            pres_coord(3) = sym(obj.coord_now(3))+obj.v(3)*tt;
        end
    end
end
